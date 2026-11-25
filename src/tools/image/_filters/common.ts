import { translate } from '../../../lib/i18n';
import { detectAlpha } from '../_basic/utils';

export type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export { detectAlpha as hasAlphaChannel };

export function createPreviewCanvas(
  source: CanvasImageSource & { width: number; height: number },
  maxDim: number = 1200,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(translate('Canvas 2D unavailable'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }
  return copy;
}
