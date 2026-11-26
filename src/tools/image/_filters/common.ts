import { translate } from '../../../lib/i18n';
import { detectAlpha } from '../_basic/utils';

export type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export { detectAlpha as hasAlphaChannel };

const FILTER_PREVIEW_EDGE = 1200;

export function getFilterExportScale(source: { width: number; height: number }, isPreview: boolean): number {
  return isPreview ? 1 : Math.max(1, Math.max(source.width, source.height) / FILTER_PREVIEW_EDGE);
}

export function createPreviewCanvas(source: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = source.width;
  const h = source.height;
  const scale = 1 / getFilterExportScale(source, false);
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
