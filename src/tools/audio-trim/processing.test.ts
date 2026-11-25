import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  adapterOptions: null as Record<string, unknown> | null,
  ffmpegOptions: null as Record<string, unknown> | null,
  adapterCalls: 0,
}));

vi.mock('../../lib/mediabunny', () => ({
  withMediabunnyFallback: vi.fn(
    async (options: Record<string, unknown>, fallback: (onProgress: (ratio: number) => void) => Promise<Blob>) => {
      state.adapterCalls++;
      state.adapterOptions = options;
      return fallback(() => {});
    },
  ),
}));

vi.mock('../../lib/ffmpeg', () => ({
  runFFmpeg: vi.fn(),
  runFFmpegWithinMediaJob: vi.fn(async (options: Record<string, unknown>) => {
    state.ffmpegOptions = options;
    return new Blob(['wav result'], { type: 'audio/wav' });
  }),
}));

import { withMediabunnyFallback } from '../../lib/mediabunny';
import { runFFmpeg } from '../../lib/ffmpeg';
import { trimAudioRange } from './processing';

describe('audio trim conversion route', () => {
  beforeEach(() => {
    state.adapterOptions = null;
    state.ffmpegOptions = null;
    state.adapterCalls = 0;
    vi.mocked(withMediabunnyFallback).mockClear();
    vi.mocked(runFFmpeg).mockClear();
  });

  it('trims the exact range to audio-only WAV through the adapter and its queued fallback', async () => {
    const file = new File(['audio'], 'voice.mp3', { type: 'audio/mpeg' });
    const result = await trimAudioRange(file, 0.1, 0.3, 1, () => {});

    expect(result.type).toBe('audio/wav');
    expect(state.adapterCalls).toBe(1);
    expect(state.adapterOptions).toMatchObject({
      input: file,
      output: 'wav',
      trim: { start: 0.1, end: 0.3 },
      tracks: { video: 'none', audio: 'primary' },
      requireAudio: true,
      audio: { codec: 'pcm-s16', forceTranscode: true },
    });

    const ffmpeg = state.ffmpegOptions;
    expect(ffmpeg).not.toBeNull();
    const args = ffmpeg?.args as string[];
    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('0.1');
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('0.2');
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:a:0');
    expect(args).toContain('-vn');
    expect(runFFmpeg).not.toHaveBeenCalled();
  });

  it('rejects invalid ranges before starting a conversion', async () => {
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' });

    await expect(trimAudioRange(file, 1, 0.5, 2, () => {})).rejects.toThrow('The end time must be after the start time.');
    expect(withMediabunnyFallback).not.toHaveBeenCalled();
    expect(state.ffmpegOptions).toBeNull();
  });
});
