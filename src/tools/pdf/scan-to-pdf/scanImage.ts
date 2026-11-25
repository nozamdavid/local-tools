import { PDFDocument } from 'pdf-lib';
import { MAX_PERSPECTIVE_SIDE } from './perspective';

export type Enhance = 'none' | 'gray' | 'bw';
export type PageSize = 'fit' | 'a4' | 'letter';

const MAX_SIDE = MAX_PERSPECTIVE_SIDE;
const PAGE_POINTS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
const MARGIN = 18;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))), type, quality),
  );
}

/** Downscales a captured or uploaded image to a manageable size and stores it as JPEG. */
export async function normalizeImage(source: Blob | HTMLVideoElement): Promise<Blob> {
  let width: number;
  let height: number;
  let draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth;
    height = source.videoHeight;
    draw = (ctx, w, h) => ctx.drawImage(source, 0, 0, w, h);
  } else {
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    width = bitmap.width;
    height = bitmap.height;
    draw = (ctx, w, h) => {
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
    };
  }

  const ratio = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = makeCanvas(width * ratio, height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  draw(ctx, canvas.width, canvas.height);

  const blob = await toBlob(canvas, 'image/jpeg', 0.92);
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

function enhanceCanvas(canvas: HTMLCanvasElement, mode: Enhance): void {
  if (mode === 'none') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  }

  if (mode === 'gray') {
    // Stretch contrast between the 1st and 99th percentile so paper turns white.
    const hist = new Uint32Array(256);
    for (const v of gray) hist[v]++;
    const cut = gray.length * 0.01;
    let low = 0;
    let high = 255;
    for (let acc = 0; low < 255 && acc + hist[low] < cut; low++) acc += hist[low];
    for (let acc = 0; high > 0 && acc + hist[high] < cut; high--) acc += hist[high];
    const span = Math.max(1, high - low);
    for (let i = 0; i < gray.length; i++) {
      const v = Math.max(0, Math.min(255, ((gray[i] - low) * 255) / span));
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    }
  } else {
    // Adaptive threshold: a pixel is ink when it is darker than its local average.
    const stride = width + 1;
    const integral = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += gray[y * width + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    const radius = Math.max(8, Math.round(Math.max(width, height) / 40));
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(width, x + radius + 1);
        const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const v = gray[y * width + x] < mean * 0.9 ? 0 : 255;
        const i = (y * width + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

async function drawEnhanced(blob: Blob, mode: Enhance, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(bitmap.width * ratio, bitmap.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  enhanceCanvas(canvas, mode);
  return canvas;
}

export async function makeThumbnail(blob: Blob, mode: Enhance): Promise<string> {
  const canvas = await drawEnhanced(blob, mode, 360);
  const url = canvas.toDataURL('image/jpeg', 0.8);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

export async function buildPdf(images: Blob[], mode: Enhance, size: PageSize, onProgress: (ratio: number) => void): Promise<Blob> {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < images.length; i++) {
    const canvas = await drawEnhanced(images[i], mode, MAX_SIDE);
    const encoded = mode === 'bw' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', 0.9);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const embedded = mode === 'bw' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    canvas.width = 0;
    canvas.height = 0;

    if (size === 'fit') {
      const page = pdf.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    } else {
      const base = PAGE_POINTS[size];
      const landscape = embedded.width > embedded.height;
      const pageW = landscape ? base.height : base.width;
      const pageH = landscape ? base.width : base.height;
      const fit = Math.min((pageW - MARGIN * 2) / embedded.width, (pageH - MARGIN * 2) / embedded.height);
      const w = embedded.width * fit;
      const h = embedded.height * fit;
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    }

    onProgress((i + 1) / images.length);
  }

  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: 'application/pdf' });
}
