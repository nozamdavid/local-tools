import { decodeImage, imageToCanvas, canvasToBlob, encodeBmp, encodeGif, loadImage } from '../../../lib/image';
import { encodeJxlCanvas } from '../../../lib/jxl';
import type { ConvertOptions, SvgScale } from './types';

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

async function loadSvgImage(file: File, scale: SvgScale, customWidth?: number): Promise<HTMLImageElement> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') {
    return decodeImage(file);
  }

  let w = parseFloat(root.getAttribute('width') || '');
  let h = parseFloat(root.getAttribute('height') || '');
  if (!w || !h || isNaN(w) || isNaN(h)) {
    const viewBox = root
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      w = viewBox[2];
      h = viewBox[3];
    } else {
      w = 512;
      h = 512;
    }
  }

  let targetW = Math.round(w);
  let targetH = Math.round(h);

  if (scale === '2x') {
    targetW = Math.round(w * 2);
    targetH = Math.round(h * 2);
  } else if (scale === '4x') {
    targetW = Math.round(w * 4);
    targetH = Math.round(h * 4);
  } else if (scale === 'custom' && customWidth && customWidth > 0) {
    targetW = Math.round(customWidth);
    targetH = Math.max(1, Math.round(h * (customWidth / w)));
  }

  root.setAttribute('width', String(targetW));
  root.setAttribute('height', String(targetH));
  const modifiedBlob = new Blob([new XMLSerializer().serializeToString(root)], {
    type: 'image/svg+xml',
  });
  return loadImage(modifiedBlob);
}

export async function convertSingleImage(options: ConvertOptions): Promise<Blob> {
  const { file, format, quality, bgColor, svgScale = '1x', customWidth, lossless } = options;

  let img: HTMLImageElement;
  if (isSvgFile(file)) {
    img = await loadSvgImage(file, svgScale, customWidth);
  } else {
    img = await decodeImage(file);
  }

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (!isSvgFile(file) && svgScale) {
    if (svgScale === '2x') {
      width = Math.round(width * 2);
      height = Math.round(height * 2);
    } else if (svgScale === '4x') {
      width = Math.round(width * 4);
      height = Math.round(height * 4);
    } else if (svgScale === 'custom' && customWidth && customWidth > 0) {
      const origW = width;
      width = Math.round(customWidth);
      height = Math.max(1, Math.round(height * (customWidth / origW)));
    }
  }

  const canvas = imageToCanvas(img, width, height);

  let renderCanvas = canvas;
  if (format === 'jpg' || format === 'bmp') {
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = canvas.width;
    flatCanvas.height = canvas.height;
    const ctx = flatCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    ctx.fillStyle = bgColor || '#ffffff';
    ctx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
    ctx.drawImage(canvas, 0, 0);
    renderCanvas = flatCanvas;
  }

  const clampedQuality = Math.max(0.01, Math.min(1, (quality || 90) / 100));

  switch (format) {
    case 'jpg':
      return await canvasToBlob(renderCanvas, 'image/jpeg', clampedQuality);
    case 'png':
      return await canvasToBlob(renderCanvas, 'image/png');
    case 'webp':
      return await canvasToBlob(renderCanvas, 'image/webp', clampedQuality);
    case 'avif': {
      if (lossless) {
        const { encodeAvifCanvas } = await import('../../../lib/avif');
        return await encodeAvifCanvas(renderCanvas, { lossless: true, quality: 100 });
      }
      return await canvasToBlob(renderCanvas, 'image/avif', clampedQuality);
    }
    case 'bmp':
      return encodeBmp(renderCanvas);
    case 'gif':
      return await encodeGif(renderCanvas);
    case 'jxl': {
      const isLossless = lossless ?? quality === 100;
      return await encodeJxlCanvas(renderCanvas, {
        quality: quality || 90,
        lossless: isLossless,
      });
    }
    default:
      throw new Error(`Unsupported output format: ${format}`);
  }
}
