import { runFFmpeg } from './ffmpeg';
import { isJxlFile, decodeJxlToBlob } from './jxl';

export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/jxl,image/svg+xml,' +
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.jxl,.svg';

export type EncodableMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

/** Decodes a browser-supported image Blob. EXIF orientation is applied by the browser. */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image could not be decoded. The file may be corrupt or in an unsupported format.'));
    };
    img.src = url;
  });
}

function isHeicFile(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

// Browsers report 0x0 (or reject the canvas draw) for SVGs without intrinsic size, so give them one.
async function withSvgSize(file: Blob): Promise<Blob> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') return file;

  const hasAbsoluteSize = (attr: string) => {
    const value = root.getAttribute(attr);
    return !!value && !value.trim().endsWith('%') && parseFloat(value) > 0;
  };
  if (hasAbsoluteSize('width') && hasAbsoluteSize('height')) return file;

  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const [vbWidth, vbHeight] = viewBox && viewBox.length === 4 ? [viewBox[2], viewBox[3]] : [512, 512];
  root.setAttribute('width', String(vbWidth > 0 ? vbWidth : 512));
  root.setAttribute('height', String(vbHeight > 0 ? vbHeight : 512));

  return new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
}

/** Like loadImage, but also handles HEIC/HEIF and JPEG XL (converted locally to PNG) and SVG without intrinsic size. */
export async function decodeImage(file: File): Promise<HTMLImageElement> {
  if (isHeicFile(file)) {
    // The /csp build avoids eval, which the page CSP forbids. Loaded on demand because it is large.
    const { heicTo } = await import('heic-to/csp');
    const png = await heicTo({ blob: file, type: 'image/png' });
    return loadImage(png);
  }
  if (isSvgFile(file)) {
    return loadImage(await withSvgSize(file));
  }
  if (await isJxlFile(file)) {
    const png = await decodeJxlToBlob(await file.arrayBuffer());
    return loadImage(png);
  }
  return loadImage(file);
}

/** Draws a source onto a new canvas, optionally scaled to width x height (defaults to the source size). */
export function imageToCanvas(
  img: CanvasImageSource & { width: number; height: number },
  width: number = img.width,
  height: number = img.height,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas;
}

/**
 * Encodes a canvas. JPEG has no alpha, so transparent pixels are flattened onto white first.
 * Rejects when the browser cannot encode the requested type. Falls back to lazy WASM worker for AVIF.
 */
export async function canvasToBlob(canvas: HTMLCanvasElement, mime: EncodableMime, quality?: number): Promise<Blob> {
  let source = canvas;
  if (mime === 'image/jpeg') {
    source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    const ctx = source.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.drawImage(canvas, 0, 0);
  }

  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, mime, quality));
  } catch {
    blob = null;
  }

  if (!blob || blob.type !== mime || blob.size === 0) {
    if (mime === 'image/avif') {
      const { encodeAvifCanvas } = await import('./avif');
      const q = quality !== undefined ? Math.max(1, Math.min(100, Math.round(quality * 100))) : 90;
      return encodeAvifCanvas(canvas, { quality: q });
    }
    const name = mime.replace('image/', '').toUpperCase();
    throw new Error(`This browser cannot encode ${name} images. Try a different output format or browser.`);
  }
  return blob;
}

/** 24-bit uncompressed BMP. Transparent pixels are flattened onto white. */
export function encodeBmp(canvas: HTMLCanvasElement): Blob {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  const { data } = ctx.getImageData(0, 0, width, height);

  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buffer = new ArrayBuffer(54 + pixelBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0x4d42, true); // "BM"
  view.setUint32(2, 54 + pixelBytes, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows stored bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);

  for (let y = 0; y < height; y++) {
    let out = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      bytes[out++] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
      bytes[out++] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
      bytes[out++] = Math.round(data[i] * alpha + 255 * (1 - alpha));
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/** ICO with one PNG-compressed image per canvas. Each canvas must be at most 256 px per side. */
export async function encodeIco(canvases: HTMLCanvasElement[]): Promise<Blob> {
  if (canvases.length === 0) throw new Error('encodeIco needs at least one canvas.');
  for (const c of canvases) {
    if (c.width > 256 || c.height > 256) throw new Error('ICO images can be at most 256 x 256 px.');
  }

  const pngs = await Promise.all(canvases.map((c) => canvasToBlob(c, 'image/png')));
  const buffers = await Promise.all(pngs.map((p) => p.arrayBuffer()));

  const headerSize = 6 + 16 * canvases.length;
  const total = buffers.reduce((sum, b) => sum + b.byteLength, headerSize);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, canvases.length, true);

  let offset = headerSize;
  canvases.forEach((c, i) => {
    const entry = 6 + i * 16;
    view.setUint8(entry, c.width === 256 ? 0 : c.width);
    view.setUint8(entry + 1, c.height === 256 ? 0 : c.height);
    view.setUint16(entry + 4, 1, true); // planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, buffers[i].byteLength, true);
    view.setUint32(entry + 12, offset, true);
    bytes.set(new Uint8Array(buffers[i]), offset);
    offset += buffers[i].byteLength;
  });

  return new Blob([out], { type: 'image/x-icon' });
}

/** Single-frame GIF encoded by ffmpeg.wasm with an optimised palette. */
export async function encodeGif(canvas: HTMLCanvasElement): Promise<Blob> {
  const png = await canvasToBlob(canvas, 'image/png');
  return runFFmpeg({
    inputs: [{ name: 'in.png', data: png }],
    args: ['-i', 'in.png', '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', 'out.gif'],
    output: 'out.gif',
  });
}
