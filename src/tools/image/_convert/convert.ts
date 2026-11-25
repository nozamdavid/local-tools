import { decodeImage, imageToCanvas, canvasToBlob, encodeBmp, encodeGif, loadImage } from '../../../lib/image';
import { encodeJxlCanvas } from '../../../lib/jxl';
import { translate } from '../../../lib/i18n';
import type { ConvertOptions, SvgScale } from './types';
import { createBoundedPngPreview, renderBoundedCanvas } from '../_basic/previews';

let avifSupportPromise: Promise<boolean> | null = null;

async function checkNativeAvifSupport(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/avif'));
    return !!blob && blob.type === 'image/avif' && blob.size > 0;
  } catch {
    return false;
  }
}

/** Tests if AVIF encoding is available via native browser support or local WASM fallback */
export function checkAvifSupport(): Promise<boolean> {
  if (!avifSupportPromise) {
    avifSupportPromise = (async () => {
      if (typeof document === 'undefined') return false;
      try {
        const native = await checkNativeAvifSupport();
        if (native) return true;
        // Fallback: bundled WASM encoder is available if WebAssembly is supported
        return typeof WebAssembly === 'object' && typeof WebAssembly.compile === 'function';
      } catch {
        return false;
      }
    })();
  }
  return avifSupportPromise;
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

async function loadConversionSource(
  file: File,
  scale: SvgScale,
  customWidth?: number,
): Promise<{ img: HTMLImageElement; width: number; height: number }> {
  let img = await decodeImage(file);
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const factor =
    scale === '4x' ? 4 : scale === '2x' ? 2 : scale === 'custom' && customWidth && customWidth > 0 ? customWidth / sourceWidth : 1;
  const width = Math.max(1, Math.round(sourceWidth * factor));
  const height = Math.max(1, Math.round(sourceHeight * factor));

  if (factor !== 1 && isSvgFile(file)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
    const root = doc.documentElement;
    if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${sourceWidth} ${sourceHeight}`);
    root.setAttribute('width', String(width));
    root.setAttribute('height', String(height));
    const source = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
    img = await loadImage(source);
  }

  return { img, width, height };
}

export async function convertSingleImage(options: ConvertOptions): Promise<Blob> {
  const { file, svgScale = '1x', customWidth } = options;
  const { img, width, height } = await loadConversionSource(file, svgScale, customWidth);
  const canvas = imageToCanvas(img, width, height);
  return encodeOutputCanvas(canvas, options);
}

async function encodeOutputCanvas(
  canvas: HTMLCanvasElement,
  options: Pick<ConvertOptions, 'format' | 'quality' | 'bgColor' | 'lossless'>,
): Promise<Blob> {
  const { format, quality, bgColor, lossless } = options;
  const renderCanvas = format === 'jpg' || format === 'bmp' ? flattenOnBackground(canvas, bgColor) : canvas;

  const clampedQuality = Math.max(0.01, Math.min(1, (quality || 90) / 100));
  switch (format) {
    case 'jpg':
      return canvasToBlob(renderCanvas, 'image/jpeg', clampedQuality);
    case 'png':
      return canvasToBlob(renderCanvas, 'image/png');
    case 'webp':
      return canvasToBlob(renderCanvas, 'image/webp', clampedQuality);
    case 'avif':
      if (lossless) {
        const { encodeAvifCanvas } = await import('../../../lib/avif');
        return encodeAvifCanvas(renderCanvas, { lossless: true, quality: 100 });
      }
      return canvasToBlob(renderCanvas, 'image/avif', clampedQuality);
    case 'bmp':
      return encodeBmp(renderCanvas);
    case 'gif':
      return encodeGif(renderCanvas);
    case 'jxl': {
      const isLossless = lossless ?? quality === 100;
      return encodeJxlCanvas(renderCanvas, { quality: quality || 90, lossless: isLossless });
    }
    default:
      throw new Error(translate('Unsupported output format: {format}', { format }));
  }
}

function flattenOnBackground(canvas: HTMLCanvasElement, bgColor: string): HTMLCanvasElement {
  const flatCanvas = document.createElement('canvas');
  flatCanvas.width = canvas.width;
  flatCanvas.height = canvas.height;
  const ctx = flatCanvas.getContext('2d');
  if (!ctx) throw new Error(translate('Canvas 2D is not available in this browser.'));
  ctx.fillStyle = bgColor || '#ffffff';
  ctx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
  ctx.drawImage(canvas, 0, 0);
  return flatCanvas;
}

export interface ConverterPreviewResult {
  blob: Blob;
  outputWidth: number;
  outputHeight: number;
  isEncodedAppearance: boolean;
}

/** Encodes only a bounded sample for the interactive conversion preview. */
export async function convertPreviewImage(options: ConvertOptions, maxEdge = 512): Promise<ConverterPreviewResult> {
  const { file, format, svgScale = '1x', customWidth } = options;
  const { img, width: outputWidth, height: outputHeight } = await loadConversionSource(file, svgScale, customWidth);

  const sample = renderBoundedCanvas(img, outputWidth, outputHeight, maxEdge);
  const appearanceCanvas = format === 'jpg' || format === 'bmp' ? flattenOnBackground(sample, options.bgColor) : sample;
  const encoded = await encodeOutputCanvas(sample, options);
  try {
    const extension = format === 'jpg' ? 'jpg' : format;
    const encodedFile = new File([encoded], `preview.${extension}`, { type: encoded.type });
    const decoded = await decodeImage(encodedFile);
    const blob = await createBoundedPngPreview(decoded, sample.width, sample.height, maxEdge);
    return { blob, outputWidth, outputHeight, isEncodedAppearance: true };
  } catch {
    // Keep the target dimensions and background appearance visible when the browser cannot decode this format.
    const fallback = await createBoundedPngPreview(appearanceCanvas, sample.width, sample.height, maxEdge);
    return { blob: fallback, outputWidth, outputHeight, isEncodedAppearance: false };
  }
}
