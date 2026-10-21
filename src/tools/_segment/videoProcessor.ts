import { runFFmpeg, type RunFFmpegInput } from '../../lib/ffmpeg';
import { SegmentClient } from './segmentClient';
import { calculateTargetSize } from './composite';
import type { VideoMaxResolution, FrameProcessingProgress } from './types';

export interface ProcessVideoOptions {
  videoFile: File;
  videoUrl: string;
  fps: number; // 15, 24, 30
  maxResolution: VideoMaxResolution;
  outputFormat: 'webm' | 'mp4';
  segmentClient: SegmentClient;
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

export async function processVideo({
  videoFile,
  videoUrl,
  fps,
  maxResolution,
  outputFormat,
  segmentClient,
  abortSignal,
  onProgress,
  compositeFn,
}: ProcessVideoOptions): Promise<Blob> {
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video file'));
  });

  if (abortSignal.aborted) throw new Error('Cancelled');

  const duration = video.duration || 1;
  const totalFrames = Math.max(1, Math.floor(duration * fps));
  const { width, height } = calculateTargetSize(video.videoWidth, video.videoHeight, maxResolution);

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Could not create 2D canvas context');

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('Could not create 2D canvas context');

  const pngInputs: RunFFmpegInput[] = [];
  const startTime = performance.now();

  for (let i = 0; i < totalFrames; i++) {
    if (abortSignal.aborted) {
      throw new Error('Cancelled');
    }

    const targetTime = Math.min(i / fps + 0.001, Math.max(0, duration - 0.001));
    video.currentTime = targetTime;

    await new Promise<void>((resolve) => {
      let resolved = false;
      const onSeeked = () => {
        if (!resolved) {
          resolved = true;
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }
      };
      video.addEventListener('seeked', onSeeked);
      // Fallback timeout in case seeked doesn't fire
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }, 500);
    });

    if (abortSignal.aborted) throw new Error('Cancelled');

    sourceCtx.drawImage(video, 0, 0, width, height);
    const frameImageData = sourceCtx.getImageData(0, 0, width, height);

    const { mask } = await segmentClient.segmentFrame(frameImageData.data, width, height);

    if (abortSignal.aborted) throw new Error('Cancelled');

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
        else reject(new Error('Failed to encode frame to PNG'));
      }, 'image/png');
    });

    const frameName = `frame_${String(i).padStart(5, '0')}.png`;
    pngInputs.push({ name: frameName, data: pngBlob });

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
      statusText: `Processing frame ${i + 1} of ${totalFrames}...`,
    });
  }

  if (abortSignal.aborted) throw new Error('Cancelled');

  onProgress({
    currentFrame: totalFrames,
    totalFrames,
    fps,
    etaSeconds: null,
    phase: 'encoding',
    statusText: 'Encoding final video with FFmpeg...',
  });

  const ext = videoFile.name.includes('.') ? videoFile.name.slice(videoFile.name.lastIndexOf('.')) : '.mp4';
  const audioSourceName = `audio_source${ext}`;

  const inputs: RunFFmpegInput[] = [...pngInputs, { name: audioSourceName, data: videoFile }];

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
      '-shortest',
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
      '-shortest',
      outputName,
    ];
  }

  return await runFFmpeg({
    inputs,
    args,
    output: outputName,
  });
}
