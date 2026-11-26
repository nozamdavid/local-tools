import { getRotationCrop } from '../../lib/rotationCrop';
import type { VideoEdit } from './engine';

export interface Clip {
  start: number;
  end: number;
  sourceIndex?: number;
  at: number;
  length: number;
}

export type FrameSize = { width: number; height: number };

export function getRotatedFrame(crop: FrameSize, angle: number) {
  const width = Math.round(crop.width);
  const height = Math.round(crop.height);
  const degrees = angle % 360;
  const rotation = degrees >= 180 ? degrees - 360 : degrees < -180 ? degrees + 360 : degrees;
  const radians = (rotation * Math.PI) / 180;
  const cardinal = rotation % 90 === 0;
  const kept = getRotationCrop(width, height, rotation);
  // Non-cardinal rotations round inward for 4:2:0. Cardinal turns keep the whole crop.
  const contentWidth = cardinal ? kept.width : Math.max(1, 2 * Math.floor(kept.width / 2));
  const contentHeight = cardinal ? kept.height : Math.max(1, 2 * Math.floor(kept.height / 2));
  return {
    rotation,
    radians,
    cardinal,
    contentWidth,
    contentHeight,
    width: 2 * Math.ceil(contentWidth / 2),
    height: 2 * Math.ceil(contentHeight / 2),
  };
}

export function getRotationSurround(crop: FrameSize, angle: number): FrameSize {
  const { radians, cardinal, contentWidth, contentHeight } = getRotatedFrame(crop, angle);
  if (cardinal) return { width: contentWidth, height: contentHeight };
  const cropWidth = Math.round(crop.width);
  const cropHeight = Math.round(crop.height);
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  return {
    width: Math.ceil(cropWidth * cos + cropHeight * sin),
    height: Math.ceil(cropWidth * sin + cropHeight * cos),
  };
}

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
  showSurround = false,
) {
  if (!hasVideoFrame(video)) return false;
  const frame = projectSize ?? { width: video.videoWidth, height: video.videoHeight };
  const crop = edit.crop ?? { x: 0, y: 0, ...frame };
  const { x, y, width, height } = {
    x: Math.round(crop.x),
    y: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  };
  const rotated = getRotatedFrame({ width, height }, edit.rotation);
  const output = showSurround ? getRotationSurround({ width, height }, edit.rotation) : rotated;
  const scale = Math.min(1, maxEdge / Math.max(output.width, output.height));
  const outputWidth = Math.max(1, Math.round(output.width * scale));
  const outputHeight = Math.max(1, Math.round(output.height * scale));
  if (canvas.width !== outputWidth) canvas.width = outputWidth;
  if (canvas.height !== outputHeight) canvas.height = outputHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return false;

  const fitted = fitFrame(video, frame);
  context.resetTransform();
  context.fillStyle = 'black';
  context.fillRect(0, 0, outputWidth, outputHeight);

  const left = Math.max(x, fitted.x);
  const right = Math.min(x + width, fitted.x + fitted.width);
  const top = Math.max(y, fitted.y);
  const bottom = Math.min(y + height, fitted.y + fitted.height);
  if (left >= right || top >= bottom) return true;
  const scaleX = video.videoWidth / fitted.width;
  const scaleY = video.videoHeight / fitted.height;

  const renderWidth = showSurround ? output.width : rotated.contentWidth;
  const renderHeight = showSurround ? output.height : rotated.contentHeight;
  context.save();
  context.scale(outputWidth / renderWidth, outputHeight / renderHeight);
  context.translate(renderWidth / 2, renderHeight / 2);
  context.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  context.rotate(rotated.radians);
  if (!showSurround && !rotated.cardinal && (width === 1 || height === 1)) {
    // Extend a one-pixel source strip to cover the footprint of the centered output samples.
    const cos = Math.abs(Math.cos(rotated.radians));
    const sin = Math.abs(Math.sin(rotated.radians));
    context.scale(
      width === 1 ? Math.max(1, renderWidth * cos + renderHeight * sin) : 1,
      height === 1 ? Math.max(1, renderWidth * sin + renderHeight * cos) : 1,
    );
  }
  context.drawImage(
    video,
    (left - fitted.x) * scaleX,
    (top - fitted.y) * scaleY,
    (right - left) * scaleX,
    (bottom - top) * scaleY,
    left - x - width / 2,
    top - y - height / 2,
    right - left,
    bottom - top,
  );
  context.restore();
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
