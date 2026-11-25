import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback } from '../../lib/mediabunny';
import { translate } from '../../lib/i18n';

function floatSamplesFromWav(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error(translate('Mediabunny returned an invalid WAV file.'));
  }

  let format: number | null = null;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const chunkName = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > view.byteLength) break;
    if (chunkName === 0x666d7420 && chunkSize >= 16) {
      format = view.getUint16(chunkStart, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkName === 0x64617461) {
      dataOffset = chunkStart;
      dataLength = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (format !== 3 || channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 32 || dataOffset < 0) {
    throw new Error(translate('Mediabunny returned WAV audio with an unexpected format.'));
  }

  const sampleCount = Math.floor(dataLength / 4);
  if (dataOffset % 4 === 0) return new Float32Array(buffer, dataOffset, sampleCount);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = view.getFloat32(dataOffset + i * 4, true);
  return samples;
}

export async function extractAudioPCM(
  file: File | Blob,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const fileName = 'name' in file ? file.name : 'input.bin';
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '.mp4';
  const inputName = `input_audio_extract${ext}`;
  const outputName = 'out.pcm';

  let pcmBlob: Blob;

  try {
    pcmBlob = await withMediabunnyFallback(
      {
        input: file,
        output: 'wav',
        audio: { codec: 'pcm-f32', sampleFormat: 'f32', sampleRate: 16000, numberOfChannels: 1, forceTranscode: true },
        tracks: { video: 'none', audio: 'primary' },
        requireAudio: true,
        allowDiscardedTrackTypes: ['video', 'subtitle'],
        onProgress,
        signal,
      },
      (fallbackProgress) =>
        runFFmpegWithinMediaJob({
          inputs: [{ name: inputName, data: file }],
          args: ['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', outputName],
          output: outputName,
          onProgress: fallbackProgress,
          signal,
        }),
    );
  } catch (err: unknown) {
    const errorText = err instanceof Error ? err.message : String(err);
    if (
      errorText.includes('Output file does not contain any stream') ||
      errorText.includes('matches no streams') ||
      errorText.includes('does not contain any stream') ||
      errorText.includes('no streams')
    ) {
      throw new Error(translate('No audio track was found in this file. Please select a file with audio.'), { cause: err });
    }
    throw err;
  }

  if (pcmBlob.size === 0) {
    throw new Error(translate('No audio track was found in this file. Please select a file with audio.'));
  }

  const arrayBuffer = await pcmBlob.arrayBuffer();
  signal?.throwIfAborted();
  if (pcmBlob.type === 'audio/wav' || (arrayBuffer.byteLength >= 12 && new DataView(arrayBuffer).getUint32(0, false) === 0x52494646)) {
    return floatSamplesFromWav(arrayBuffer);
  }
  // Ensure the byte offset and length are 4-byte aligned for Float32Array
  const sampleCount = Math.floor(arrayBuffer.byteLength / 4);
  return new Float32Array(arrayBuffer, 0, sampleCount);
}
