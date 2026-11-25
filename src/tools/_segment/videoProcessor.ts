import { runFFmpegWithinMediaJob, type RunFFmpegInput } from '../../lib/ffmpeg';
import { withMediaJobLock } from '../../lib/mediaQueue';
import type { SegmentClient } from './segmentClient';
import { calculateTargetSize } from './composite';
import type { VideoMaxResolution, FrameProcessingProgress } from './types';
import { translate } from '../../lib/i18n';

const MIB = 1024 * 1024;
const MAX_SOURCE_MIB = 128;
const MAX_FRAME_MIB = 128;
const MAX_FRAMES = 900;
const MAX_FRAME_SIDE = 4096;
const MAX_FRAME_PIXELS = 4096 * 2160;

export interface ProcessVideoOptions {
  videoFile: File;
  videoUrl: string;
  fps: number; // 15, 24, 30
  maxResolution: VideoMaxResolution;
  outputFormat: 'webm' | 'mp4';
  segmentClient: Pick<SegmentClient, 'segmentFrame'>;
  abortSignal: AbortSignal;
  onProgress: (progress: FrameProcessingProgress) => void;
  compositeFn: (
    ctx: CanvasRenderingContext2D,
    info: {
      frameImageData: ImageData;
      mask: Uint8ClampedArray;
      width: number;
      height: number;
      frameIndex: number;
    },
  ) => void;
}

function waitForVideoEvent(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', signal: AbortSignal, start: () => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(event, succeed);
      video.removeEventListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    const succeed = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(translate('Failed to load video file')));
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timeout = setTimeout(fail, 10000);
    video.addEventListener(event, succeed, { once: true });
    video.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try {
      start();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function processVideo(options: ProcessVideoOptions): Promise<Blob> {
  options.abortSignal.throwIfAborted();
  if (options.videoFile.size > MAX_SOURCE_MIB * MIB) {
    throw new Error(translate('The source video exceeds {limit} MiB. Trim or compress it before exporting.', { limit: MAX_SOURCE_MIB }));
  }

  // Hold the same media lock through collection and encoding to keep PNGs out of the job queue.
  return withMediaJobLock(async () => {
    options.abortSignal.throwIfAborted();
    const inputs: RunFFmpegInput[] = [];
    const totalFrames = await collectVideoFrames(options, inputs);
    return encodeVideo(options, inputs, totalFrames);
  });
}

async function collectVideoFrames(options: ProcessVideoOptions, inputs: RunFFmpegInput[]): Promise<number> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await waitForVideoEvent(video, 'loadedmetadata', options.abortSignal, () => {
      video.src = options.videoUrl;
    });
    return await collectFrames(video, options, inputs);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function collectFrames(
  video: HTMLVideoElement,
  { fps, maxResolution, segmentClient, abortSignal, onProgress, compositeFn }: ProcessVideoOptions,
  inputs: RunFFmpegInput[],
): Promise<number> {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) {
    throw new Error(translate('Failed to load video file'));
  }
  const totalFrames = Math.max(1, Math.round(duration * fps));
  if (totalFrames > MAX_FRAMES) {
    throw new Error(translate('This export exceeds {limit} frames. Trim the clip or choose a lower frame rate.', { limit: MAX_FRAMES }));
  }
  const { width, height } = calculateTargetSize(video.videoWidth, video.videoHeight, maxResolution);
  if (Math.max(width, height) > MAX_FRAME_SIDE || width * height > MAX_FRAME_PIXELS) {
    throw new Error(translate('The export resolution is too large. Choose 1080p or a lower processing resolution.'));
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error(translate('Could not create 2D canvas context'));

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error(translate('Could not create 2D canvas context'));

  let frameBytes = 0;
  const startTime = performance.now();

  for (let i = 0; i < totalFrames; i++) {
    abortSignal.throwIfAborted();

    const targetTime = Math.min(i / fps + 0.001, Math.max(0, duration - 0.001));
    if (video.currentTime !== targetTime || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, 'seeked', abortSignal, () => {
        video.currentTime = targetTime;
      });
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error(translate('Failed to load video file'));
    }
    abortSignal.throwIfAborted();

    sourceCtx.drawImage(video, 0, 0, width, height);
    const frameImageData = sourceCtx.getImageData(0, 0, width, height);

    const { mask } = await segmentClient.segmentFrame(frameImageData.data, width, height);

    abortSignal.throwIfAborted();

    compositeFn(outputCtx, {
      frameImageData,
      mask,
      width,
      height,
      frameIndex: i,
    });

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(translate('Failed to encode frame to PNG')));
      }, 'image/png');
    });
    abortSignal.throwIfAborted();

    frameBytes += pngBlob.size;
    if (frameBytes > MAX_FRAME_MIB * MIB) {
      throw new Error(
        translate('The rendered frames exceed {limit} MiB. Trim the clip, lower the frame rate, or choose a lower processing resolution.', {
          limit: MAX_FRAME_MIB,
        }),
      );
    }

    const frameName = `frame_${String(i).padStart(5, '0')}.png`;
    inputs.push({ name: frameName, data: pngBlob });

    const elapsed = (performance.now() - startTime) / 1000;
    const rate = (i + 1) / elapsed;
    const remaining = totalFrames - (i + 1);
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

    onProgress({
      currentFrame: i + 1,
      totalFrames,
      fps,
      etaSeconds,
      phase: 'processing',
      statusText: translate('Processing frame {current} of {total}...', { current: i + 1, total: totalFrames }),
    });
  }

  return totalFrames;
}

async function encodeVideo(
  { videoFile, fps, outputFormat, abortSignal, onProgress }: ProcessVideoOptions,
  inputs: RunFFmpegInput[],
  totalFrames: number,
): Promise<Blob> {
  abortSignal.throwIfAborted();

  onProgress({
    currentFrame: totalFrames,
    totalFrames,
    fps,
    etaSeconds: null,
    phase: 'encoding',
    statusText: translate('Encoding final video with FFmpeg...'),
  });

  const ext = videoFile.name.includes('.') ? videoFile.name.slice(videoFile.name.lastIndexOf('.')) : '.mp4';
  const audioSourceName = `audio_source${ext}`;

  inputs.push({ name: audioSourceName, data: videoFile });

  let outputName: string;
  let args: string[];

  if (outputFormat === 'webm') {
    outputName = 'output.webm';
    args = [
      '-f',
      'image2',
      '-framerate',
      String(fps),
      '-i',
      'frame_%05d.png',
      '-i',
      audioSourceName,
      '-c:v',
      // libvpx-vp9 corrupts memory or crashes the tab in ffmpeg.wasm 0.12; VP8 also carries alpha.
      'libvpx',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-b:v',
      '2M',
      '-crf',
      '10',
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-map',
      '0:v:0',
      '-map',
      '1:a?',
      '-t',
      String(totalFrames / fps),
      outputName,
    ];
  } else {
    outputName = 'output.mp4';
    args = [
      '-f',
      'image2',
      '-framerate',
      String(fps),
      '-i',
      'frame_%05d.png',
      '-i',
      audioSourceName,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-map',
      '0:v:0',
      '-map',
      '1:a?',
      '-t',
      String(totalFrames / fps),
      outputName,
    ];
  }

  return runFFmpegWithinMediaJob({
    inputs,
    args,
    output: outputName,
    signal: abortSignal,
  });
}
