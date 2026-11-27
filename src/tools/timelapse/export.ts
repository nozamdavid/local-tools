import { canvasToBlob, decodeImage } from '../../lib/image';
import { withMediaJobLock } from '../../lib/mediaQueue';
import { drawFrame, getFrameSize, type FrameSettings } from './render';

async function encodeNative(
  canvas: HTMLCanvasElement,
  frameCount: number,
  fps: number,
  repeats: number,
  draw: (index: number) => Promise<void>,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<Blob | null> {
  if (typeof VideoEncoder === 'undefined') return null;

  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } = await import('mediabunny');
  const quality = QUALITY_HIGH;
  if (!(await canEncodeVideo('avc', { width: canvas.width, height: canvas.height, frameRate: fps, quality }))) return null;
  signal.throwIfAborted();

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', quality });
  output.addVideoTrack(source, { frameRate: fps });

  const cancel = () => void output.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await output.start();
    for (let index = 0; index < frameCount; index++) {
      await draw(index);
      for (let repeat = 0; repeat < repeats; repeat++) {
        signal.throwIfAborted();
        await source.add((index * repeats + repeat) / fps, 1 / fps);
      }
      progress(((index + 1) / frameCount) * 0.95);
    }

    signal.throwIfAborted();
    source.close();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer) throw new Error('The MP4 encoder produced no output.');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', cancel);
    if (output.state !== 'finalized') await output.cancel().catch(() => {});
  }
}

export function exportTimelapse(
  files: File[],
  settings: FrameSettings,
  fps: number,
  repeats: number,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  return withMediaJobLock(async () => {
    if (!files.length) throw new Error('Add at least one image to export a timelapse.');
    if (!Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(repeats) || repeats < 1) {
      throw new Error('Use a positive frame rate and a whole number of repeats.');
    }

    const first = await decodeImage(files[0]);
    signal.throwIfAborted();
    const { naturalWidth: projectWidth, naturalHeight: projectHeight } = first;
    const size = getFrameSize(projectWidth, projectHeight, settings);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    let fraction = 0;
    const progress = (next: number) => {
      fraction = Math.max(fraction, next);
      onProgress(fraction);
    };
    const draw = async (index: number) => {
      signal.throwIfAborted();
      const image = index === 0 ? first : await decodeImage(files[index]);
      signal.throwIfAborted();
      drawFrame(canvas, image, image.naturalWidth, image.naturalHeight, projectWidth, projectHeight, settings);
    };

    try {
      const native = await encodeNative(canvas, files.length, fps, repeats, draw, signal, progress).catch(() => null);
      signal.throwIfAborted();
      if (native) {
        progress(1);
        return native;
      }

      const { runFFmpegWithinMediaJob } = await import('../../lib/ffmpeg');
      const inputs = [];
      for (let index = 0; index < files.length; index++) {
        await draw(index);
        const data = await canvasToBlob(canvas, 'image/jpeg', 0.95);
        signal.throwIfAborted();
        inputs.push({ name: `frame-${index}.jpg`, data });
        progress(((index + 1) / files.length) * 0.5);
      }

      const output = 'timelapse.mp4';
      // Read each photo once at its hold rate and duplicate frames at the output rate.
      const result = await runFFmpegWithinMediaJob({
        inputs,
        args: [
          '-framerate',
          `${fps}/${repeats}`,
          '-start_number',
          '0',
          '-i',
          'frame-%d.jpg',
          '-vf',
          `fps=${fps}`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          output,
        ],
        output,
        signal,
        onProgress: (ratio) => progress(0.5 + ratio * 0.49),
      });
      signal.throwIfAborted();
      progress(1);
      return result;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, signal);
}
