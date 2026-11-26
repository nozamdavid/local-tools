import { runFFmpeg, runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediaJobLock } from '../../lib/mediaQueue';
import { withMediabunnyFallback, type MediabunnyOptions } from '../../lib/mediabunny';
import { translate } from '../../lib/i18n';
import {
  aggregatePeakChunk,
  FALLBACK_SAMPLE_RATE,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_FILE_BYTES,
  MAX_FALLBACK_WAV_BYTES,
  MAX_NATIVE_PCM_FLOAT_SAMPLES,
  MAX_WAVEFORM_VALUES,
  WAVEFORM_BIN_COUNT,
  validateTrimRange,
} from './audioTrim';

export class AudioTrimInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioTrimInputError';
  }
}

export class AudioTrimLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioTrimLimitError';
  }
}

export interface AudioAnalysis {
  duration: number;
  sampleRate: number;
  channelCount: number;
  peaks: Float32Array;
  decoder: 'Mediabunny' | 'FFmpeg downsampled';
}

interface AudioMetadata {
  duration: number;
  sampleRate: number;
  channelCount: number;
}

interface NativeWaveformResult {
  metadata: AudioMetadata;
  peaks?: Float32Array;
  decodeError?: unknown;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Audio analysis was cancelled.', 'AbortError');
}

function assertFileWithinLimit(file: Blob): void {
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    throw new AudioTrimLimitError('Choose an audio file that is 64 MB or smaller.');
  }
}

function validateAudioMetadata(duration: number | null, sampleRate: number, channelCount: number): AudioMetadata {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    throw new AudioTrimInputError('Could not read the audio duration for this file.');
  }
  if (duration > MAX_AUDIO_DURATION_SECONDS) {
    throw new AudioTrimLimitError('Audio clips must be 10 minutes or shorter.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channelCount) || channelCount <= 0) {
    throw new AudioTrimInputError('Could not read the audio sample format for this file.');
  }
  return { duration, sampleRate, channelCount };
}

async function decodeNativeWaveform(file: Blob, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<NativeWaveformResult> {
  const runtime = await import('mediabunny');
  throwIfAborted(signal);

  const input = new runtime.Input({ source: new runtime.BlobSource(file), formats: runtime.ALL_FORMATS });
  const disposeOnAbort = () => input.dispose();
  signal.addEventListener('abort', disposeOnAbort, { once: true });

  try {
    if (!(await input.canRead())) {
      throw new AudioTrimInputError('This file could not be identified as an audio file.');
    }

    const tracks = await input.getTracks();
    if (tracks.some((track) => track.type === 'video')) {
      throw new AudioTrimInputError('Choose an audio-only file. Video files are not supported here.');
    }

    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new AudioTrimInputError('This file has no audio track.');
    }

    const track = (await input.getPrimaryAudioTrack()) ?? audioTracks[0];
    const duration = await track.getDurationFromMetadata({ skipLiveWait: true });
    const sampleRate = await track.getSampleRate();
    const channelCount = await track.getNumberOfChannels();
    const metadata = validateAudioMetadata(duration, sampleRate, channelCount);

    if (!(await track.canDecode())) {
      return { metadata, decodeError: new Error('The browser does not support decoding this audio codec.') };
    }

    const estimatedFloatSamples = Math.ceil(metadata.duration * metadata.sampleRate * metadata.channelCount);
    if (!Number.isFinite(estimatedFloatSamples) || estimatedFloatSamples > MAX_NATIVE_PCM_FLOAT_SAMPLES) {
      throw new AudioTrimLimitError('Decoded PCM for waveform analysis is limited to 256 MiB. Try a shorter or lower sample rate file.');
    }

    const peaks = new Float32Array(WAVEFORM_BIN_COUNT);
    const stride = Math.max(1, Math.ceil(estimatedFloatSamples / MAX_WAVEFORM_VALUES));
    let decodedFloatSamples = 0;
    let decodedFrames = 0;
    let aggregatedValues = 0;
    const sink = new runtime.AudioSampleSink(track);

    try {
      for await (const sample of sink.samples(0, metadata.duration)) {
        const sampleChannels = sample.numberOfChannels;
        const sampleFrames = sample.numberOfFrames;
        const valuesInSample = sampleFrames * sampleChannels;

        try {
          throwIfAborted(signal);
          if (!Number.isSafeInteger(valuesInSample) || decodedFloatSamples + valuesInSample > MAX_NATIVE_PCM_FLOAT_SAMPLES) {
            throw new AudioTrimLimitError(
              'Decoded PCM for waveform analysis is limited to 256 MiB. Try a shorter or lower sample rate file.',
            );
          }
          for (let frameOffset = 0; frameOffset < sampleFrames; frameOffset += 8192) {
            throwIfAborted(signal);
            const frameCount = Math.min(8192, sampleFrames - frameOffset);
            const data = new Float32Array(frameCount * sampleChannels);
            sample.copyTo(data, { planeIndex: 0, format: 'f32', frameOffset, frameCount });
            aggregatedValues += aggregatePeakChunk(
              peaks,
              {
                timestamp: sample.timestamp + frameOffset / sample.sampleRate,
                sampleRate: sample.sampleRate,
                channelCount: sampleChannels,
                data,
                firstFrame: decodedFrames + frameOffset,
              },
              metadata.duration,
              stride,
              Math.max(0, MAX_WAVEFORM_VALUES - aggregatedValues),
            );
          }
        } finally {
          sample.close();
        }

        decodedFloatSamples += valuesInSample;
        decodedFrames += sampleFrames;
        onProgress(Math.min(0.99, Math.max(0, sample.timestamp / metadata.duration)));
      }
    } catch (error) {
      if (signal.aborted || error instanceof AudioTrimLimitError) throw error;
      return { metadata, decodeError: error };
    }

    throwIfAborted(signal);
    return { metadata, peaks };
  } finally {
    signal.removeEventListener('abort', disposeOnAbort);
    input.dispose();
  }
}

function safeInputName(file: Blob & { name?: string }): string {
  const extension = file.name?.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() ?? 'audio';
  return `input.${extension}`;
}

function ffmpegSeconds(value: number): string {
  return Number(value.toPrecision(15)).toString();
}

interface ParsedPcmWav {
  dataOffset: number;
  dataBytes: number;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  formatCode: number;
}

function readAscii(view: DataView, offset: number, count: number): string {
  let result = '';
  for (let index = 0; index < count; index++) result += String.fromCharCode(view.getUint8(offset + index));
  return result;
}

function parsePcmWav(view: DataView): ParsedPcmWav {
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('The local audio decoder returned an invalid WAV file.');
  }

  let format: ParsedPcmWav | null = null;
  let dataOffset = -1;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const chunkId = readAscii(view, offset, 4);
    const chunkBytes = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkBytes;
    if (chunkEnd > view.byteLength) throw new Error('The local audio decoder returned an incomplete WAV file.');

    if (chunkId === 'fmt ' && chunkBytes >= 16) {
      format = {
        dataOffset: -1,
        dataBytes: 0,
        formatCode: view.getUint16(chunkStart, true),
        channelCount: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataBytes = chunkBytes;
    }

    offset = chunkEnd + (chunkBytes % 2);
  }

  if (
    !format ||
    dataOffset < 0 ||
    format.formatCode !== 1 ||
    format.channelCount !== 1 ||
    format.sampleRate !== FALLBACK_SAMPLE_RATE ||
    format.bitsPerSample !== 16
  ) {
    throw new Error('The local audio decoder returned WAV audio in an unexpected format.');
  }
  return { ...format, dataOffset, dataBytes };
}

function peaksFromPcmWav(buffer: ArrayBuffer, duration: number): Float32Array {
  const view = new DataView(buffer);
  const wav = parsePcmWav(view);
  if (wav.dataBytes > MAX_FALLBACK_WAV_BYTES || wav.dataOffset + wav.dataBytes > view.byteLength) {
    throw new AudioTrimLimitError('The decoded waveform exceeds the 12 MiB local preview limit.');
  }

  const frameCount = Math.floor(wav.dataBytes / (wav.bitsPerSample / 8));
  const stride = Math.max(1, Math.ceil(frameCount / MAX_WAVEFORM_VALUES));
  const peaks = new Float32Array(WAVEFORM_BIN_COUNT);
  let aggregatedValues = 0;
  const chunkFrames = 8192;

  for (let frameOffset = 0; frameOffset < frameCount; frameOffset += chunkFrames) {
    const frames = Math.min(chunkFrames, frameCount - frameOffset);
    const values = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
      values[frame] = view.getInt16(wav.dataOffset + (frameOffset + frame) * 2, true) / 32768;
    }
    aggregatedValues += aggregatePeakChunk(
      peaks,
      {
        timestamp: frameOffset / wav.sampleRate,
        sampleRate: wav.sampleRate,
        channelCount: 1,
        data: values,
        firstFrame: frameOffset,
      },
      duration,
      stride,
      Math.max(0, MAX_WAVEFORM_VALUES - aggregatedValues),
    );
  }

  return peaks;
}

export async function loadAudioAnalysis(file: File, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<AudioAnalysis> {
  assertFileWithinLimit(file);
  throwIfAborted(signal);

  const native = await withMediaJobLock(() => decodeNativeWaveform(file, signal, onProgress), signal);
  throwIfAborted(signal);
  if (native.peaks) {
    onProgress(1);
    return { ...native.metadata, peaks: native.peaks, decoder: 'Mediabunny' };
  }

  const inputName = safeInputName(file);
  const outputName = 'waveform.wav';
  let wav: Blob;
  try {
    wav = await runFFmpeg({
      signal,
      inputs: [{ name: inputName, data: file }],
      args: [
        '-i',
        inputName,
        '-map',
        '0:a:0',
        '-vn',
        '-t',
        String(native.metadata.duration),
        '-ac',
        '1',
        '-ar',
        String(FALLBACK_SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        outputName,
      ],
      output: outputName,
      onProgress,
    });
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      translate('The browser could not decode this audio for its waveform. The local FFmpeg fallback also failed.{reason}', { reason }),
      { cause: error },
    );
  }

  throwIfAborted(signal);
  if (wav.size > MAX_FALLBACK_WAV_BYTES) {
    throw new AudioTrimLimitError('The decoded waveform exceeds the 12 MiB local preview limit.');
  }
  const peaks = peaksFromPcmWav(await wav.arrayBuffer(), native.metadata.duration);
  onProgress(1);
  return { ...native.metadata, peaks, decoder: 'FFmpeg downsampled' };
}

export function buildAudioTrimOptions(file: File, start: number, end: number, onProgress: (ratio: number) => void): MediabunnyOptions {
  return {
    input: file,
    output: 'wav',
    audio: { codec: 'pcm-s16', forceTranscode: true },
    trim: { start, end },
    copy: false,
    tracks: { video: 'none', audio: 'primary' },
    requireAudio: true,
    allowDiscardedTrackTypes: ['subtitle'],
    onProgress,
  };
}

export async function trimAudioRange(
  file: File,
  start: number,
  end: number,
  duration: number,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const range = validateTrimRange(start, end, duration);
  const inputName = safeInputName(file);
  const outputName = 'trimmed.wav';

  return withMediabunnyFallback(buildAudioTrimOptions(file, range.start, range.end, onProgress), (fallbackProgress) =>
    runFFmpegWithinMediaJob({
      inputs: [{ name: inputName, data: file }],
      args: [
        '-i',
        inputName,
        '-ss',
        ffmpegSeconds(range.start),
        '-t',
        ffmpegSeconds(range.end - range.start),
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'pcm_s16le',
        outputName,
      ],
      output: outputName,
      onProgress: fallbackProgress,
    }),
  );
}
