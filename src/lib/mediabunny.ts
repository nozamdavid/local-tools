import type {
  AudioCodec,
  AudioSample,
  ConversionAudioOptions,
  ConversionVideoOptions,
  InputAudioTrack,
  InputTrack,
  InputVideoTrack,
  MediaCodec,
  Output,
  Conversion,
  TrackType,
  VideoCodec,
} from 'mediabunny';
import { withMediaJobLock } from './mediaQueue';

export type MediabunnyOutput = 'mp4' | 'mov' | 'mkv' | 'webm' | 'm4a' | 'mp3' | 'wav';
export type MediaQuality = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
export type TrackMode = 'all' | 'primary' | 'none';

export type MediaVideoOptions = Omit<ConversionVideoOptions, 'quality'> & { quality?: MediaQuality };
export type MediaAudioOptions = Omit<ConversionAudioOptions, 'quality'> & { quality?: MediaQuality };
type MediaVideoSettings =
  MediaVideoOptions | ((track: InputVideoTrack, index: number) => MediaVideoOptions | undefined | Promise<MediaVideoOptions | undefined>);
type MediaAudioSettings =
  MediaAudioOptions | ((track: InputAudioTrack, index: number) => MediaAudioOptions | undefined | Promise<MediaAudioOptions | undefined>);

export interface MediaTrackSelection {
  video?: TrackMode;
  audio?: TrackMode;
}

export interface MediabunnyOptions {
  input: Blob;
  output: MediabunnyOutput;
  video?: MediaVideoSettings;
  audio?: MediaAudioSettings;
  trim?: { start?: number; end?: number };
  copy?:
    false | { mode?: 'forced' | 'preferred'; shiftTolerance?: number; boundaryPolicy?: 'expand' | 'shrink'; boundaryTolerance?: number };
  tracks?: MediaTrackSelection;
  requireVideo?: boolean;
  requireAudio?: boolean;
  allowDiscardedTrackTypes?: TrackType[];
  audioEncoderFallback?: 'aac' | 'mp3';
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface MediaTrackSummary {
  index: number;
  type: TrackType;
  codec: MediaCodec | null;
  name: string | null;
  language: string;
  bitrate: number | null;
  width?: number;
  height?: number;
  pixelAspectRatio?: string;
  rotation?: number;
  sampleRate?: number;
  channels?: number;
  primary: boolean;
}

export interface MediaSummary {
  format: string;
  mimeType: string;
  duration: number | null;
  metadata: Record<string, string>;
  tracks: MediaTrackSummary[];
}

export class MediaTrackRequirementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaTrackRequirementError';
  }
}

export function createAudioGainProcessor(gain: number, ceiling: number | null): (sample: AudioSample) => Promise<AudioSample> {
  let runtimePromise: Promise<Runtime> | null = null;
  return async (sample) => {
    const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
    sample.copyTo(data, { planeIndex: 0, format: 'f32' });
    for (let index = 0; index < data.length; index++) {
      const amplified = data[index] * gain;
      data[index] = ceiling === null ? amplified : Math.max(-ceiling, Math.min(ceiling, amplified));
    }
    const runtime = await (runtimePromise ??= import('mediabunny'));
    return new runtime.AudioSample({
      data,
      format: 'f32',
      numberOfChannels: sample.numberOfChannels,
      sampleRate: sample.sampleRate,
      timestamp: sample.timestamp,
    });
  };
}

type Runtime = typeof import('mediabunny');
type ConcreteVideoOptions = ConversionVideoOptions;
type ConcreteAudioOptions = ConversionAudioOptions;

function outputFormat(runtime: Runtime, kind: MediabunnyOutput) {
  switch (kind) {
    case 'mp4':
    case 'm4a':
      return new runtime.Mp4OutputFormat();
    case 'mov':
      return new runtime.MovOutputFormat();
    case 'mkv':
      return new runtime.MkvOutputFormat();
    case 'webm':
      return new runtime.WebMOutputFormat();
    case 'mp3':
      return new runtime.Mp3OutputFormat();
    case 'wav':
      return new runtime.WavOutputFormat();
  }
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function progressReporter(callback?: (ratio: number) => void) {
  let current = 0;
  const publish = (ratio: number) => {
    current = Math.max(current, clampProgress(ratio));
    callback?.(current);
  };
  return {
    mediabunny: (ratio: number) => publish(clampProgress(ratio) * 0.35),
    fallback: (ratio: number) => publish(0.35 + clampProgress(ratio) * 0.64),
    done: () => publish(1),
  };
}

async function resolvesTo(
  options: MediabunnyOptions['video'],
  track: InputVideoTrack,
  index: number,
): Promise<MediaVideoOptions | undefined> {
  return typeof options === 'function' ? options(track, index) : options;
}

async function resolvesAudioTo(
  options: MediabunnyOptions['audio'],
  track: InputAudioTrack,
  index: number,
): Promise<MediaAudioOptions | undefined> {
  return typeof options === 'function' ? options(track, index) : options;
}

function concreteVideo(runtime: Runtime, options: MediaVideoOptions | undefined): ConcreteVideoOptions | undefined {
  if (!options) return undefined;
  const { quality, ...rest } = options;
  return quality ? { ...rest, quality: new runtime.Quality(quality) } : rest;
}

function concreteAudio(runtime: Runtime, options: MediaAudioOptions | undefined): ConcreteAudioOptions | undefined {
  if (!options) return undefined;
  const { quality, ...rest } = options;
  return quality ? { ...rest, quality: new runtime.Quality(quality) } : rest;
}

function shouldSelect(
  track: InputTrack,
  selection: MediaTrackSelection,
  primaryVideo: InputVideoTrack | null,
  primaryAudio: InputAudioTrack | null,
) {
  if (track.type === 'video') {
    const mode = selection.video ?? 'all';
    return mode === 'all' || (mode === 'primary' && track === primaryVideo);
  }
  if (track.type === 'audio') {
    const mode = selection.audio ?? 'all';
    return mode === 'all' || (mode === 'primary' && track === primaryAudio);
  }
  return true;
}

let mp3EncoderRegistered = false;
let aacEncoderRegistered = false;

async function registerFallbackEncoder(codec: AudioCodec, extension: MediabunnyOptions['audioEncoderFallback']) {
  if (extension !== codec) return false;
  if (codec === 'mp3') {
    if (!mp3EncoderRegistered) {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
      registerMp3Encoder();
      mp3EncoderRegistered = true;
    }
  } else if (codec === 'aac') {
    if (!aacEncoderRegistered) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      aacEncoderRegistered = true;
    }
  }
  return true;
}

async function canEncodeAudio(
  runtime: Runtime,
  codec: AudioCodec,
  options: Parameters<Runtime['canEncodeAudio']>[1],
  extension?: MediabunnyOptions['audioEncoderFallback'],
) {
  if (await runtime.canEncodeAudio(codec, options)) return true;
  if (!(await registerFallbackEncoder(codec, extension))) return false;
  return runtime.canEncodeAudio(codec, options);
}

function videoNeedsTranscode(
  options: ConcreteVideoOptions | undefined,
  codec: VideoCodec | null,
  outputCodecs: VideoCodec[],
  dimensions: { width: number; height: number },
) {
  if (options?.discard) return false;
  return Boolean(
    options?.forceTranscode ||
    options?.quality ||
    options?.bitrate !== undefined ||
    options?.frameRate !== undefined ||
    options?.keyFrameInterval !== undefined ||
    options?.process ||
    options?.crop ||
    options?.rotate ||
    options?.flip ||
    (options?.codec && options.codec !== codec) ||
    (options?.width !== undefined && options.width !== dimensions.width) ||
    (options?.height !== undefined && options.height !== dimensions.height) ||
    !codec ||
    !outputCodecs.includes(codec),
  );
}

function audioNeedsTranscode(
  options: ConcreteAudioOptions | undefined,
  codec: AudioCodec | null,
  outputCodecs: AudioCodec[],
  sampleRate: number,
  channels: number,
) {
  if (options?.discard) return false;
  return Boolean(
    options?.forceTranscode ||
    options?.quality ||
    options?.bitrate !== undefined ||
    options?.process ||
    options?.sampleFormat ||
    (options?.codec && options.codec !== codec) ||
    (options?.sampleRate !== undefined && options.sampleRate !== sampleRate) ||
    (options?.numberOfChannels !== undefined && options.numberOfChannels !== channels) ||
    !codec ||
    !outputCodecs.includes(codec),
  );
}

async function canRunConversion(
  runtime: Runtime,
  options: MediabunnyOptions,
  selected: InputTrack[],
  format: ReturnType<typeof outputFormat>,
  videoConfigs: Map<InputVideoTrack, ConcreteVideoOptions | undefined>,
  audioConfigs: Map<InputAudioTrack, ConcreteAudioOptions | undefined>,
) {
  const videoCodecs = format.getSupportedVideoCodecs();
  const audioCodecs = format.getSupportedAudioCodecs();

  for (const track of selected) {
    const codec = await track.getCodec();
    if (track.type === 'video') {
      const videoTrack = track as InputVideoTrack;
      const videoCodec = codec as VideoCodec | null;
      const config = videoConfigs.get(videoTrack);
      const sourceWidth = await videoTrack.getDisplayWidth();
      const sourceHeight = await videoTrack.getDisplayHeight();
      if (videoNeedsTranscode(config, videoCodec, videoCodecs, { width: sourceWidth, height: sourceHeight })) {
        if (!config?.codec || !videoCodec || !(await videoTrack.canDecode())) return false;
        const measuredFrameRate =
          config.frameRate === undefined
            ? (await videoTrack.computeFrameRateMetrics({ targetPacketCount: 256 }).catch(() => null))?.medianFrameRate
            : undefined;
        const encodable = await runtime.canEncodeVideo(config.codec as VideoCodec, {
          width: config.width ?? config.crop?.width ?? sourceWidth,
          height: config.height ?? config.crop?.height ?? sourceHeight,
          quality: config.quality,
          bitrate: config.bitrate,
          frameRate: config.frameRate ?? (measuredFrameRate && measuredFrameRate > 0 ? measuredFrameRate : undefined),
        });
        if (!encodable) return false;
      } else if (!videoCodec || !videoCodecs.includes(videoCodec)) {
        return false;
      }
    } else if (track.type === 'audio') {
      const audioTrack = track as InputAudioTrack;
      const audioCodec = codec as AudioCodec | null;
      const config = audioConfigs.get(audioTrack);
      const sourceSampleRate = await audioTrack.getSampleRate();
      const sourceChannels = await audioTrack.getNumberOfChannels();
      if (audioNeedsTranscode(config, audioCodec, audioCodecs, sourceSampleRate, sourceChannels)) {
        if (!config?.codec || !audioCodec || !(await audioTrack.canDecode())) return false;
        const supported = await canEncodeAudio(
          runtime,
          config.codec,
          {
            numberOfChannels: config.processedNumberOfChannels ?? config.numberOfChannels ?? sourceChannels,
            sampleRate: config.processedSampleRate ?? config.sampleRate ?? sourceSampleRate,
            quality: config.quality,
            bitrate: config.bitrate,
          },
          options.audioEncoderFallback,
        );
        if (!supported) return false;
      } else if (!audioCodec || !audioCodecs.includes(audioCodec)) {
        return false;
      }
    } else if (!codec || !format.getSupportedCodecs().includes(codec)) {
      if (!options.allowDiscardedTrackTypes?.includes(track.type)) return false;
    }
  }

  return true;
}

async function runNativeConversion(options: MediabunnyOptions, onProgress: (ratio: number) => void): Promise<Blob | null> {
  const runtime = await import('mediabunny');
  options.signal?.throwIfAborted();
  const input = new runtime.Input({ source: new runtime.BlobSource(options.input), formats: runtime.ALL_FORMATS });
  let output: Output | null = null;
  let conversion: Conversion | null = null;
  let finalized = false;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    if (conversion) cancellation = conversion.cancel().catch(() => {});
  };

  try {
    if (!(await input.canRead())) return null;

    const tracks = await input.getTracks();
    const primaryVideo = await input.getPrimaryVideoTrack();
    const primaryAudio = await input.getPrimaryAudioTrack();
    const selection = options.tracks ?? {};
    if (options.requireVideo && !tracks.some((track) => track.type === 'video')) {
      throw new MediaTrackRequirementError('This file does not contain a video track.');
    }
    if (options.requireAudio && !tracks.some((track) => track.type === 'audio')) {
      throw new MediaTrackRequirementError('This file has no audio track, so there is nothing to extract.');
    }

    const selected = tracks.filter((track) => shouldSelect(track, selection, primaryVideo, primaryAudio));
    const format = outputFormat(runtime, options.output);
    const videoConfigs = new Map<InputVideoTrack, ConcreteVideoOptions | undefined>();
    const audioConfigs = new Map<InputAudioTrack, ConcreteAudioOptions | undefined>();

    for (const track of tracks) {
      if (track.type === 'video') {
        const videoTrack = track as InputVideoTrack;
        const raw = await resolvesTo(options.video, videoTrack, videoTrack.number);
        videoConfigs.set(
          videoTrack,
          concreteVideo(runtime, shouldSelect(track, selection, primaryVideo, primaryAudio) ? raw : { discard: true }),
        );
      } else if (track.type === 'audio') {
        const audioTrack = track as InputAudioTrack;
        const raw = await resolvesAudioTo(options.audio, audioTrack, audioTrack.number);
        audioConfigs.set(
          audioTrack,
          concreteAudio(runtime, shouldSelect(track, selection, primaryVideo, primaryAudio) ? raw : { discard: true }),
        );
      }
    }

    if (!(await canRunConversion(runtime, options, selected, format, videoConfigs, audioConfigs))) return null;

    const target = new runtime.BufferTarget();
    output = new runtime.Output({ format, target });
    const conversionOptions: import('mediabunny').ConversionOptions = {
      input,
      output,
      tracks: 'all',
      showWarnings: false,
      copy: options.copy,
      trim: options.trim,
      video: (track) => videoConfigs.get(track),
      audio: (track) => audioConfigs.get(track),
    };
    conversion = await runtime.Conversion.init(conversionOptions);

    const utilized = new Set(conversion.utilizedTracks);
    const unexpectedDrop = selected.some((track) => !utilized.has(track) && !options.allowDiscardedTrackTypes?.includes(track.type));
    const unexpectedTrack = conversion.discardedTracks.some(
      ({ track }) => selected.includes(track) && !options.allowDiscardedTrackTypes?.includes(track.type),
    );
    if (!conversion.isValid || unexpectedDrop || unexpectedTrack) return null;

    options.signal?.throwIfAborted();
    options.signal?.addEventListener('abort', cancel, { once: true });
    conversion.onProgress = (ratio) => onProgress(ratio);
    await conversion.execute();
    options.signal?.throwIfAborted();
    finalized = output.state === 'finalized';
    if (!finalized || !target.buffer) return null;
    return new Blob([target.buffer], { type: await output.getMimeType() });
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    if (cancellation) {
      await cancellation;
    } else if (conversion && conversion.state !== 'done' && conversion.state !== 'canceled') {
      try {
        await conversion.cancel();
      } catch {
        // The original conversion error is more useful than cleanup errors.
      }
    } else if (output && !finalized && output.state !== 'canceled') {
      try {
        await output.cancel();
      } catch {
        // The original conversion error is more useful than cleanup errors.
      }
    }
    input.dispose();
  }
}

export function withMediabunnyFallback(
  options: MediabunnyOptions,
  fallback: (onProgress: (ratio: number) => void) => Promise<Blob>,
): Promise<Blob> {
  return withMediaJobLock(async () => {
    options.signal?.throwIfAborted();
    const progress = progressReporter(options.onProgress);
    try {
      const result = await runNativeConversion(options, progress.mediabunny);
      options.signal?.throwIfAborted();
      if (result) {
        progress.done();
        return result;
      }
    } catch (error) {
      if (error instanceof MediaTrackRequirementError) throw error;
    }

    options.signal?.throwIfAborted();
    const result = await fallback(progress.fallback);
    options.signal?.throwIfAborted();
    progress.done();
    return result;
  });
}

function toMetadataRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined || typeof item === 'object') continue;
    result[key] = String(item);
  }
  return result;
}

export function probeMedia(file: Blob): Promise<MediaSummary | null> {
  return withMediaJobLock(async () => {
    let input: import('mediabunny').Input | null = null;
    try {
      const runtime = await import('mediabunny');
      input = new runtime.Input({ source: new runtime.BlobSource(file), formats: runtime.ALL_FORMATS });
      if (!(await input.canRead())) return null;
      const tracks = await input.getTracks();
      const primaryVideo = await input.getPrimaryVideoTrack();
      const primaryAudio = await input.getPrimaryAudioTrack();
      const format = await input.getFormat();
      const duration = await input.getDurationFromMetadata();
      const tags = await input.getMetadataTags().catch(() => ({}));
      const summarized: MediaTrackSummary[] = [];

      for (let index = 0; index < tracks.length; index++) {
        const track = tracks[index];
        const base: MediaTrackSummary = {
          index,
          type: track.type,
          codec: await track.getCodec().catch(() => null),
          name: await track.getName().catch(() => null),
          language: await track.getLanguageCode().catch(() => 'und'),
          bitrate: await track.getBitrate().catch(() => null),
          primary: track === primaryVideo || track === primaryAudio,
        };

        if (track.type === 'video') {
          const video = track as InputVideoTrack;
          const [width, height, pixelAspectRatio, rotation] = await Promise.all([
            video.getDisplayWidth().catch(() => 0),
            video.getDisplayHeight().catch(() => 0),
            video.getPixelAspectRatio().catch(() => null),
            video.getRotation().catch(() => 0),
          ]);
          if (width > 0) base.width = width;
          if (height > 0) base.height = height;
          if (pixelAspectRatio) base.pixelAspectRatio = `${pixelAspectRatio.num}:${pixelAspectRatio.den}`;
          base.rotation = rotation;
        } else if (track.type === 'audio') {
          const audio = track as InputAudioTrack;
          const [sampleRate, channels] = await Promise.all([
            audio.getSampleRate().catch(() => 0),
            audio.getNumberOfChannels().catch(() => 0),
          ]);
          if (sampleRate > 0) base.sampleRate = sampleRate;
          if (channels > 0) base.channels = channels;
        }
        summarized.push(base);
      }

      return {
        format: format.name,
        mimeType: await input.getMimeType().catch(() => format.mimeType),
        duration,
        metadata: toMetadataRecord(tags),
        tracks: summarized,
      };
    } catch {
      return null;
    } finally {
      input?.dispose();
    }
  });
}
