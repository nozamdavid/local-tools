import type { VideoEdit } from './engine';

export interface Clip {
  start: number;
  end: number;
  sourceIndex?: number;
  at: number;
  length: number;
}

export type FrameSize = { width: number; height: number };

export function buildTimeline(edit: VideoEdit) {
  let duration = 0;
  const clips: Clip[] = edit.segments.map((range) => {
    const length = (range.end - range.start) / edit.speed;
    const clip = { ...range, at: duration, length };
    duration += length;
    return clip;
  });
  return { clips, duration };
}

export function locateTime(clips: Clip[], time: number, speed: number) {
  const index = clips.findIndex((clip) => time < clip.at + clip.length);
  const clip = clips[index === -1 ? clips.length - 1 : index];
  return {
    index: index === -1 ? clips.length - 1 : index,
    source: Math.max(clip.start, Math.min(clip.end, clip.start + (time - clip.at) * speed)),
  };
}

export function fitFrame(video: HTMLVideoElement, frame: FrameSize) {
  const scale = Math.min(frame.width / video.videoWidth, frame.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
}

export function hasVideoFrame(video: HTMLVideoElement) {
  return !video.seeking && video.currentSrc === video.src && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

export function drawFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  edit: VideoEdit,
  maxEdge = Infinity,
  projectSize: FrameSize | null = null,
) {
  if (!hasVideoFrame(video)) return false;
  const frame = projectSize ?? { width: video.videoWidth, height: video.videoHeight };
  const { x, y, width, height } = edit.crop ?? { x: 0, y: 0, ...frame };
  const turned = edit.rotation === 90 || edit.rotation === 270;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const outputWidth = turned ? scaledHeight : scaledWidth;
  const outputHeight = turned ? scaledWidth : scaledHeight;
  if (canvas.width !== outputWidth) canvas.width = outputWidth;
  if (canvas.height !== outputHeight) canvas.height = outputHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return false;

  const fitted = fitFrame(video, frame);
  const scaleX = scaledWidth / width;
  const scaleY = scaledHeight / height;
  context.resetTransform();
  context.fillStyle = 'black';
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.setTransform(1, 0, 0, 1, outputWidth / 2, outputHeight / 2);
  context.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  context.rotate((edit.rotation * Math.PI) / 180);
  context.drawImage(
    video,
    (fitted.x - x) * scaleX - scaledWidth / 2,
    (fitted.y - y) * scaleY - scaledHeight / 2,
    fitted.width * scaleX,
    fitted.height * scaleY,
  );
  return true;
}

export async function readFrameRate(file: File) {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    const stats = await track?.computePacketStats(96);
    const rate = stats?.averagePacketRate;
    return rate && rate > 0 ? rate : 30;
  } finally {
    input.dispose();
  }
}

export function readAudioDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const fail = () => finish();
    const timeout = window.setTimeout(fail, 10_000);

    function finish(duration?: number) {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', fail);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (duration && Number.isFinite(duration)) resolve(duration);
      else reject(new Error('Could not read the audio file.'));
    }

    signal.addEventListener('abort', fail, { once: true });
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = fail;
    audio.src = url;
  });
}
