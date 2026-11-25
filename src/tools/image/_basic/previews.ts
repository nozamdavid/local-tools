import { canvasToBlob, type EncodableMime } from '../../../lib/image';
import { translate } from '../../../lib/i18n';
import { detectAlpha } from './utils';

export interface BoundedPreviewResult {
  blob: Blob;
  width: number;
  height: number;
  estimatedBytes: number;
}

export function renderBoundedCanvas(
  source: CanvasImageSource,
  targetWidth: number,
  targetHeight: number,
  maxEdge = 512,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(1, targetWidth, targetHeight));
  const width = Math.max(1, Math.round(targetWidth * scale));
  const height = Math.max(1, Math.round(targetHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(translate('Canvas 2D unavailable'));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export async function createBoundedPngPreview(source: CanvasImageSource, width: number, height: number, maxEdge = 512): Promise<Blob> {
  return canvasToBlob(renderBoundedCanvas(source, width, height, maxEdge), 'image/png');
}

export async function encodeBoundedPreview(
  source: CanvasImageSource,
  width: number,
  height: number,
  format: EncodableMime,
  quality: number,
  maxEdge = 512,
): Promise<BoundedPreviewResult> {
  const canvas = renderBoundedCanvas(source, width, height, maxEdge);
  const blob = await canvasToBlob(canvas, format, format === 'image/png' ? undefined : quality);
  const areaRatio = (width * height) / (canvas.width * canvas.height);
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    estimatedBytes: Math.round(blob.size * areaRatio),
  };
}

export async function createTargetCompressionPreview(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetBytes: number,
  preferWebp: boolean,
  maxEdge = 512,
): Promise<BoundedPreviewResult & { outputWidth: number; outputHeight: number; quality: number }> {
  const sourceSample = renderBoundedCanvas(source, sourceWidth, sourceHeight, maxEdge);
  const mime: EncodableMime = preferWebp || detectAlpha(sourceSample) ? 'image/webp' : 'image/jpeg';
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.15, 0.1];
  let fallback: (BoundedPreviewResult & { outputWidth: number; outputHeight: number; quality: number }) | null = null;

  for (const scale of scales) {
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = renderBoundedCanvas(source, outputWidth, outputHeight, maxEdge);
    const areaRatio = (outputWidth * outputHeight) / (canvas.width * canvas.height);
    const encode = async (quality: number) => {
      const blob = await canvasToBlob(canvas, mime, quality);
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        estimatedBytes: Math.round(blob.size * areaRatio),
        outputWidth,
        outputHeight,
        quality,
      };
    };

    let low = 0.3;
    let high = 0.95;
    const smallest = await encode(low);
    fallback = smallest;
    if (smallest.estimatedBytes > targetBytes) continue;

    const largest = await encode(high);
    if (largest.estimatedBytes <= targetBytes) return largest;
    let best = smallest;
    for (let i = 0; i < 6; i += 1) {
      const middle = (low + high) / 2;
      const candidate = await encode(middle);
      if (candidate.estimatedBytes <= targetBytes) {
        best = candidate;
        low = middle;
      } else {
        high = middle;
      }
    }
    return best;
  }

  if (fallback) return fallback;
  throw new Error(translate('Could not create a compression preview.'));
}
