import { expect, it, vi } from 'vitest';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { drawSubjectOnTop } from './composite';
import { SegmentClient } from './segmentClient';
import { processVideo, waitForVideoEvent } from './videoProcessor';

vi.mock('../../lib/ffmpeg', () => ({ runFFmpegWithinMediaJob: vi.fn() }));

it('rejects first-frame loading when the media element reports a decode error', async () => {
  const video = new EventTarget() as HTMLVideoElement;
  const signal = new AbortController().signal;
  const removeListener = vi.spyOn(video, 'removeEventListener');
  await expect(waitForVideoEvent(video, 'loadeddata', signal, () => video.dispatchEvent(new Event('error')))).rejects.toThrow(
    'Failed to load video file',
  );
  expect(removeListener).toHaveBeenCalledWith('loadeddata', expect.any(Function));
});

it('composites a first frame matching the default canvas dimensions', () => {
  const pixels = new Uint8ClampedArray(300 * 150 * 4);
  const scratch = { width: 300, height: 150, getContext: () => scratchContext };
  const scratchContext = { createImageData: () => ({ data: pixels }), putImageData: vi.fn() };
  const target = { drawImage: vi.fn() };
  vi.stubGlobal('document', { createElement: () => scratch });
  try {
    const mask = new Uint8ClampedArray(300 * 150).fill(128);
    drawSubjectOnTop(target as unknown as CanvasRenderingContext2D, { data: pixels } as ImageData, mask, 300, 150);
    expect(pixels[3]).toBe(128);
    expect(target.drawImage).toHaveBeenCalledWith(scratch, 0, 0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects pending segmentation when the worker cannot deliver a frame', async () => {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessageerror: () => {},
  };
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return worker;
      }
    },
  );
  try {
    const client = new SegmentClient();
    const frame = new Uint8ClampedArray(16);
    const result = client.segmentFrame(frame, 2, 2);
    worker.onmessageerror();
    await expect(result).rejects.toThrow('Video segmentation worker failed');
    await expect(client.segmentFrame(frame, 2, 2)).rejects.toThrow('Video segmentation worker is not running');
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

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
