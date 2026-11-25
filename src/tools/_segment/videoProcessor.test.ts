import { expect, it, vi } from 'vitest';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { processVideo } from './videoProcessor';

vi.mock('../../lib/ffmpeg', () => ({ runFFmpegWithinMediaJob: vi.fn() }));

it('accepts frames up to the PNG byte cap and stops before passing any frames to FFmpeg if it is exceeded', async () => {
  const video = new (class extends EventTarget {
    duration = 2 / 30;
    videoWidth = 2;
    videoHeight = 2;
    readyState = 2;
    removeAttribute = vi.fn();
    load = vi.fn();

    set src(_url: string) {
      this.dispatchEvent(new Event('loadedmetadata'));
    }

    set currentTime(_seconds: number) {
      this.dispatchEvent(new Event('seeked'));
    }
  })();
  // Simulate the Blob sizes without allocating the encoded payload.
  const pngSizes = [128 * 1024 * 1024, 1];
  const canvas = {
    getContext: () => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    }),
    toBlob: (callback: BlobCallback) => callback({ size: pngSizes.shift() } as Blob),
  };
  vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'video' ? video : canvas) });
  vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });

  const onProgress = vi.fn();
  const segmentClient = {
    segmentFrame: async () => ({ mask: new Uint8ClampedArray(4), width: 2, height: 2 }),
  };

  try {
    await expect(
      processVideo({
        videoFile: new File([], 'clip.mp4'),
        videoUrl: 'blob:clip',
        fps: 30,
        maxResolution: '720p',
        outputFormat: 'mp4',
        segmentClient,
        abortSignal: new AbortController().signal,
        onProgress,
        compositeFn: vi.fn(),
      }),
    ).rejects.toThrow('The rendered frames exceed 128 MiB.');
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: 'processing', currentFrame: 1 }));
    expect(runFFmpegWithinMediaJob).not.toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
