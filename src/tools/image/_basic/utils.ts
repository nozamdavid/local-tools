import type { EncodableMime } from '../../../lib/image';
import { withSuffix } from '../../../lib/format';

/** Determines default encodable MIME type and extension from a file */
export function getDefaultFormat(file: File, fallbackMime: EncodableMime = 'image/png'): { mime: EncodableMime; ext: string } {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type === 'image/jpeg' || /\.(jpe?g)$/i.test(name)) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (type === 'image/png' || /\.png$/i.test(name)) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (type === 'image/webp' || /\.webp$/i.test(name)) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (type === 'image/avif' || /\.avif$/i.test(name)) {
    return { mime: 'image/avif', ext: 'avif' };
  }

  // HEIC, SVG, GIF, BMP etc.
  if (fallbackMime === 'image/jpeg') {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  return { mime: 'image/png', ext: 'png' };
}

/** Check if canvas has any transparent or semi-transparent pixels */
export function detectAlpha(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { width, height } = canvas;
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const step = Math.max(1, Math.floor(data.length / 40000));
    for (let i = 3; i < data.length; i += step * 4) {
      if (data[i] < 250) {
        return true;
      }
    }
  } catch {
    // If getImageData fails (e.g. security origin), default to false
    return false;
  }
  return false;
}

/** High-quality downscaling using iterative step-down halving */
export function renderScaledCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const tw = Math.max(1, Math.round(targetWidth));
  const th = Math.max(1, Math.round(targetHeight));

  // If identical or upscaling, direct draw with high smoothing
  if (tw >= sourceWidth && th >= sourceHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, tw, th);
    return canvas;
  }

  // Step-down halving prevents aliasing when downscaling significantly
  let curW = sourceWidth;
  let curH = sourceHeight;
  let curCanvas = document.createElement('canvas');
  curCanvas.width = curW;
  curCanvas.height = curH;
  let curCtx = curCanvas.getContext('2d');
  if (!curCtx) throw new Error('Canvas 2D unavailable');
  curCtx.imageSmoothingEnabled = true;
  curCtx.imageSmoothingQuality = 'high';
  curCtx.drawImage(source, 0, 0, curW, curH);

  while (curW * 0.5 > tw && curH * 0.5 > th) {
    const nextW = Math.max(tw, Math.round(curW * 0.5));
    const nextH = Math.max(th, Math.round(curH * 0.5));
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = nextW;
    nextCanvas.height = nextH;
    const nextCtx = nextCanvas.getContext('2d');
    if (!nextCtx) break;
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(curCanvas, 0, 0, nextW, nextH);
    curCanvas = nextCanvas;
    curW = nextW;
    curH = nextH;
  }

  if (curW === tw && curH === th) {
    return curCanvas;
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = tw;
  finalCanvas.height = th;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('Canvas 2D unavailable');
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(curCanvas, 0, 0, tw, th);
  return finalCanvas;
}

export function formatOutputFile(originalName: string, suffix: string, ext: string): string {
  return withSuffix(originalName, suffix, ext);
}
