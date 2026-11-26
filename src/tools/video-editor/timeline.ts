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
  const rotation = (((angle % 360) + 540) % 360) - 180;
  const radians = (rotation * Math.PI) / 180;
  const cardinal = rotation % 90 === 0;
  const turned = Math.abs(rotation) === 90;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const contentWidth = cardinal ? (turned ? height : width) : width * cos + height * sin;
  const contentHeight = cardinal ? (turned ? width : height) : width * sin + height * cos;
  // MP4 and WebM use 4:2:0. Keep the legacy top-left alignment for any extra pixel at a quarter turn.
  const outputWidth = Math.ceil(contentWidth / 2) * 2;
  const outputHeight = Math.ceil(contentHeight / 2) * 2;
  return {
    rotation,
    radians,
    cardinal,
    width: outputWidth,
    height: outputHeight,
    centerX: (cardinal ? contentWidth : outputWidth) / 2,
    centerY: (cardinal ? contentHeight : outputHeight) / 2,
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
  const output = getRotatedFrame({ width, height }, edit.rotation);
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
  context.save();
  context.scale(outputWidth / output.width, outputHeight / output.height);
  context.translate(output.centerX, output.centerY);
  context.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  context.rotate(output.radians);
  context.beginPath();
  context.rect(-width / 2, -height / 2, width, height);
  context.clip();
  context.drawImage(video, fitted.x - x - width / 2, fitted.y - y - height / 2, fitted.width, fitted.height);
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
