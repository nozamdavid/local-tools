import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
  readable: true,
  tracks: [] as Array<Record<string, unknown>>,
  dropTrackTypes: [] as string[],
  executeThrows: false,
  canEncodeVideo: true,
  canEncodeAudio: true,
  conversionOptions: null as Record<string, unknown> | null,
  conversionRuns: 0,
  conversionCancels: 0,
  inputDisposals: 0,
  outputCancels: 0,
  videoCapabilityCalls: 0,
  audioCapabilityCalls: 0,
  createdSamples: 0,
}));

vi.mock('mediabunny', () => {
  class Format {
    getSupportedVideoCodecs() {
      return ['avc', 'vp8'];
    }
    getSupportedAudioCodecs() {
      return ['aac', 'opus', 'mp3', 'pcm-s16', 'pcm-f32'];
    }
    getSupportedCodecs() {
      return [...this.getSupportedVideoCodecs(), ...this.getSupportedAudioCodecs()];
    }
    get mimeType() {
      return 'video/mp4';
    }
  }

  class BlobSource {
    constructor(readonly blob: Blob) {}
  }

  class Input {
    constructor() {}
    canRead() {
      return Promise.resolve(runtimeState.readable);
    }
    getTracks() {
      return Promise.resolve(runtimeState.tracks);
    }
    getPrimaryVideoTrack() {
      return Promise.resolve(runtimeState.tracks.find((track) => track.type === 'video') ?? null);
    }
    getPrimaryAudioTrack() {
      return Promise.resolve(runtimeState.tracks.find((track) => track.type === 'audio') ?? null);
    }
    dispose() {
      runtimeState.inputDisposals++;
    }
  }

  class BufferTarget {
    buffer: ArrayBuffer | null = null;
  }

  class Output {
    state = 'pending';
    target: BufferTarget;
    constructor(options: { target: BufferTarget }) {
      this.target = options.target;
    }
    getMimeType() {
      return Promise.resolve('video/mp4');
    }
    cancel() {
      runtimeState.outputCancels++;
      this.state = 'canceled';
      return Promise.resolve();
    }
  }

  class Quality {
    constructor(readonly value: string) {}
  }

  class AudioSample {
    data: Float32Array;
    readonly format: string;
    readonly numberOfFrames: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly timestamp: number;
    constructor(init: { data: Float32Array; format: string; numberOfChannels: number; sampleRate: number; timestamp: number }) {
      runtimeState.createdSamples++;
      this.data = init.data;
      this.format = init.format;
      this.numberOfFrames = init.data.length / init.numberOfChannels;
      this.numberOfChannels = init.numberOfChannels;
      this.sampleRate = init.sampleRate;
      this.timestamp = init.timestamp;
    }
  }

  class Conversion {
    state = 'idle';
    isValid = true;
    onProgress?: (ratio: number) => void;
    utilizedTracks: Array<Record<string, unknown>>;
    discardedTracks: Array<{ track: Record<string, unknown>; reason: string }>;
    constructor(readonly options: Record<string, unknown>) {
      runtimeState.conversionOptions = options;
      const input = options.input as { getTracks: () => Promise<Array<Record<string, unknown>>> };
      const trackOptions = options.video as (track: Record<string, unknown>) => { discard?: boolean } | undefined;
      const audioOptions = options.audio as (track: Record<string, unknown>) => { discard?: boolean } | undefined;
      const tracks = runtimeState.tracks;
      this.utilizedTracks = tracks.filter((track) => {
        if (runtimeState.dropTrackTypes.includes(String(track.type))) return false;
        if (track.type === 'video') return !trackOptions?.(track)?.discard;
        if (track.type === 'audio') return !audioOptions?.(track)?.discard;
        return true;
      });
      this.discardedTracks = tracks
        .filter((track) => runtimeState.dropTrackTypes.includes(String(track.type)))
        .map((track) => ({ track, reason: 'no_encodable_target_codec' }));
      void input;
    }
    static init(options: Record<string, unknown>) {
      return Promise.resolve(new Conversion(options));
    }
    execute() {
      this.state = 'executing';
      runtimeState.conversionRuns++;
      if (runtimeState.executeThrows) return Promise.reject(new Error('mock encode failure'));
      const output = this.options.output as { target: BufferTarget; state: string };
      output.target.buffer = new ArrayBuffer(16);
      output.state = 'finalized';
      this.state = 'done';
      this.onProgress?.(0.5);
      this.onProgress?.(Number.NaN);
      return Promise.resolve();
    }
    cancel() {
      runtimeState.conversionCancels++;
      this.state = 'canceled';
      const output = this.options.output as { cancel: () => Promise<void> };
      return output.cancel();
    }
  }

  return {
    ALL_FORMATS: [],
    BlobSource,
    Input,
    BufferTarget,
    Output,
    Conversion,
    Quality,
    AudioSample,
    Mp4OutputFormat: Format,
    MovOutputFormat: Format,
    MkvOutputFormat: Format,
    WebMOutputFormat: Format,
    Mp3OutputFormat: Format,
    WavOutputFormat: Format,
    canEncodeVideo: async () => {
      runtimeState.videoCapabilityCalls++;
      return runtimeState.canEncodeVideo;
    },
    canEncodeAudio: async () => {
      runtimeState.audioCapabilityCalls++;
      return runtimeState.canEncodeAudio;
    },
  };
});

import { createAudioGainProcessor, withMediabunnyFallback } from './mediabunny';

function makeTrack(type: 'video' | 'audio', codec: string): Record<string, unknown> {
  return {
    type,
    number: 1,
    getCodec: async () => codec,
    getDisplayWidth: async () => 640,
    getDisplayHeight: async () => 360,
    getSampleRate: async () => 48000,
    getNumberOfChannels: async () => 2,
    canDecode: async () => true,
    computeFrameRateMetrics: async () => ({ medianFrameRate: 30 }),
  };
}

function resetState() {
  runtimeState.readable = true;
  runtimeState.tracks = [];
  runtimeState.dropTrackTypes = [];
  runtimeState.executeThrows = false;
  runtimeState.canEncodeVideo = true;
  runtimeState.canEncodeAudio = true;
  runtimeState.conversionOptions = null;
  runtimeState.conversionRuns = 0;
  runtimeState.conversionCancels = 0;
  runtimeState.inputDisposals = 0;
  runtimeState.outputCancels = 0;
  runtimeState.videoCapabilityCalls = 0;
  runtimeState.audioCapabilityCalls = 0;
  runtimeState.createdSamples = 0;
}

describe('Mediabunny adapter', () => {
  beforeEach(resetState);

  it('uses the fallback when the input container is unsupported and reports monotonic clamped progress', async () => {
    runtimeState.readable = false;
    const progress: number[] = [];
    const fallback = vi.fn(async (onProgress: (ratio: number) => void) => {
      onProgress(0.8);
      onProgress(0.2);
      onProgress(4);
      return new Blob(['fallback']);
    });

    const result = await withMediabunnyFallback(
      { input: new Blob(['source']), output: 'mp4', onProgress: (ratio) => progress.push(ratio) },
      fallback,
    );

    expect(await result.text()).toBe('fallback');
    expect(fallback).toHaveBeenCalledOnce();
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.every((ratio) => ratio >= 0 && ratio <= 1)).toBe(true);
    expect(runtimeState.inputDisposals).toBe(1);
  });

  it('runs a supported stream-copy conversion without asking for an encoder', async () => {
    runtimeState.tracks = [makeTrack('video', 'avc')];

    const fallback = vi.fn(async () => new Blob(['fallback']));
    const result = await withMediabunnyFallback(
      { input: new Blob(['source']), output: 'mp4', copy: { mode: 'forced' }, requireVideo: true },
      fallback,
    );

    expect(result.type).toBe('video/mp4');
    expect(fallback).not.toHaveBeenCalled();
    expect((runtimeState.conversionOptions?.copy as { mode: string }).mode).toBe('forced');
    expect(runtimeState.videoCapabilityCalls).toBe(0);
    expect(runtimeState.inputDisposals).toBe(1);
    expect(runtimeState.outputCancels).toBe(0);
  });

  it('falls back after conversion failure and cancels output and input resources', async () => {
    runtimeState.tracks = [makeTrack('video', 'avc')];
    runtimeState.executeThrows = true;

    const fallback = vi.fn(async () => new Blob(['fallback']));
    await withMediabunnyFallback({ input: new Blob(['source']), output: 'mp4', copy: { mode: 'forced' } }, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(runtimeState.conversionCancels).toBe(1);
    expect(runtimeState.outputCancels).toBe(1);
    expect(runtimeState.inputDisposals).toBe(1);
  });

  it('falls back instead of accepting an output that omitted a retained audio track', async () => {
    runtimeState.tracks = [makeTrack('video', 'avc'), makeTrack('audio', 'aac')];
    runtimeState.dropTrackTypes = ['audio'];

    const fallback = vi.fn(async () => new Blob(['fallback']));
    await withMediabunnyFallback({ input: new Blob(['source']), output: 'mp4' }, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(runtimeState.inputDisposals).toBe(1);
    expect(runtimeState.outputCancels).toBe(1);
  });

  it('passes requested dimensions and exact trim times through to the native conversion', async () => {
    runtimeState.tracks = [makeTrack('video', 'avc')];
    const progress: number[] = [];

    await withMediabunnyFallback(
      {
        input: new Blob(['source']),
        output: 'mp4',
        video: { codec: 'avc', quality: 'high', forceTranscode: true, width: 320, height: 180, fit: 'contain' },
        trim: { start: 1.25, end: 4.75 },
        copy: false,
        onProgress: (ratio) => progress.push(ratio),
      },
      async () => new Blob(['fallback']),
    );

    const options = runtimeState.conversionOptions;
    expect(options?.trim).toEqual({ start: 1.25, end: 4.75 });
    const video = options?.video as (track: Record<string, unknown>) => { width: number; height: number; fit: string };
    expect(video(runtimeState.tracks[0])).toMatchObject({ width: 320, height: 180, fit: 'contain' });
    expect(runtimeState.videoCapabilityCalls).toBe(1);
    expect(progress).toEqual([0.175, 0.175, 1]);
  });

  it('creates gain-adjusted samples with a peak ceiling', async () => {
    const sample = {
      numberOfFrames: 2,
      numberOfChannels: 1,
      sampleRate: 16000,
      timestamp: 3,
      copyTo(destination: Float32Array) {
        destination.set([0.25, -0.75]);
      },
    } as unknown as Parameters<ReturnType<typeof createAudioGainProcessor>>[0];

    const processed = await createAudioGainProcessor(2, 0.95)(sample);

    expect(runtimeState.createdSamples).toBe(1);
    expect((processed as unknown as { data: Float32Array }).data).toEqual(new Float32Array([0.5, -0.95]));
    expect(processed.timestamp).toBe(3);
  });
});
