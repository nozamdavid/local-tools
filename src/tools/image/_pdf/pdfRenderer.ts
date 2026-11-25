import { loadPdfjs } from '../../../lib/pdf';
import { translate } from '../../../lib/i18n';
import { canvasToBlob } from '../../../lib/image';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface LoadPdfOptions {
  onPassword?: (verifyPassword: (password: string) => void, reason: number) => void;
  signal?: AbortSignal;
}

export async function loadPdfDocument(file: File | Blob, options?: LoadPdfOptions): Promise<PDFDocumentProxy> {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  signal?.throwIfAborted();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
  });

  if (options?.onPassword) {
    loadingTask.onPassword = (verifyPassword: (password: string) => void, reason: number) => {
      options.onPassword!(verifyPassword, reason);
    };
  }

  let abort: (() => void) | undefined;
  try {
    return await new Promise<PDFDocumentProxy>((resolve, reject) => {
      abort = () => {
        reject(signal?.reason);
        void loadingTask.destroy().catch(() => {});
      };
      signal?.addEventListener('abort', abort, { once: true });
      loadingTask.promise.then(resolve, reject);
    });
  } catch (error) {
    if (abort) signal?.removeEventListener('abort', abort);
    if (!signal?.aborted) await loadingTask.destroy().catch(() => {});
    throw error;
  }
}

export async function renderPdfThumbnail(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  maxDim: number = 160,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const page = await pdfDoc.getPage(pageNumber);
  const canvas = document.createElement('canvas');
  let cancelRender: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    const unscaled = page.getViewport({ scale: 1 });
    const scale = maxDim / Math.max(unscaled.width, unscaled.height);
    const viewport = page.getViewport({ scale });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(translate('Canvas 2D unavailable'));

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport, canvas });
    cancelRender = () => task.cancel();
    signal?.addEventListener('abort', cancelRender, { once: true });
    if (signal?.aborted) task.cancel();
    await task.promise;
    signal?.throwIfAborted();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    return dataUrl;
  } finally {
    if (cancelRender) signal?.removeEventListener('abort', cancelRender);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

export async function renderPdfPageToBlob(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  format: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number = 0.92,
): Promise<Blob> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(translate('Canvas 2D unavailable'));
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality));
    if (!blob?.size || blob.type !== format) {
      throw new Error(translate('Failed to encode PDF page {page} to {format}', { page: pageNumber, format }));
    }
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

interface PdfImageData {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
}

function drawPdfImage(canvas: HTMLCanvasElement, image: PdfImageData, kinds: typeof import('pdfjs-dist').ImageKind): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(translate('Canvas 2D unavailable'));
  if (image.bitmap) {
    ctx.drawImage(image.bitmap, 0, 0);
    return true;
  }

  const { width, height, kind, data } = image;
  if (!data) return false;
  const pixels = ctx.createImageData(width, height);
  const rgba = pixels.data;
  if (kind === kinds.RGBA_32BPP) {
    rgba.set(data.subarray(0, rgba.length));
  } else if (kind === kinds.RGB_24BPP) {
    for (let src = 0, dest = 0; src + 2 < data.length && dest < rgba.length; src += 3, dest += 4) {
      rgba[dest] = data[src];
      rgba[dest + 1] = data[src + 1];
      rgba[dest + 2] = data[src + 2];
      rgba[dest + 3] = 255;
    }
  } else if (kind === kinds.GRAYSCALE_1BPP) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * stride + (x >> 3)];
        const shade = ((byte >> (7 - (x & 7))) & 1) * 255;
        const dest = (y * width + x) * 4;
        rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = shade;
        rgba[dest + 3] = 255;
      }
    }
  } else {
    return false;
  }
  ctx.putImageData(pixels, 0, 0);
  return true;
}

export async function extractEmbeddedImagesOrPages(
  pdfDoc: PDFDocumentProxy,
  baseFilename: string,
  options: {
    mode: 'embedded' | 'pages';
    format: 'image/jpeg' | 'image/png' | 'image/webp';
    dpi?: number;
    quality?: number;
    onProgress?: (current: number, total: number) => void;
  },
): Promise<{ items: { name: string; blob: Blob }[]; usedFallback: boolean }> {
  const pdfjs = await loadPdfjs();
  const numPages = pdfDoc.numPages;
  const items: { name: string; blob: Blob }[] = [];
  const ext = options.format === 'image/jpeg' ? 'jpg' : options.format === 'image/webp' ? 'webp' : 'png';
  const cleanBase = baseFilename.replace(/\.pdf$/i, '');
  let usedFallback = false;

  if (options.mode === 'embedded') {
    let imgIdx = 1;
    for (let p = 1; p <= numPages; p++) {
      options.onProgress?.(p - 1, numPages);
      const page = await pdfDoc.getPage(p);
      try {
        const ops = await page.getOperatorList();

        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          let image: PdfImageData | null;
          if (fn === pdfjs.OPS.paintInlineImageXObject) {
            image = ops.argsArray[i][0];
          } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
            const objId = ops.argsArray[i][0];
            const objs = objId.startsWith('g_') ? page.commonObjs : page.objs;
            image = objs.has(objId) ? objs.get(objId) : await new Promise((resolve) => objs.get(objId, resolve));
          } else {
            continue;
          }

          if (!image?.width || !image.height) continue;
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          try {
            if (!drawPdfImage(canvas, image, pdfjs.ImageKind)) continue;
            const blob = await canvasToBlob(canvas, options.format, options.quality ?? 0.92);
            items.push({ name: `${cleanBase}-image-${imgIdx}.${ext}`, blob });
            imgIdx++;
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      } finally {
        page.cleanup();
      }
    }

    if (items.length === 0) {
      // Fallback to rendering pages
      usedFallback = true;
    }
  }

  if (options.mode === 'pages' || usedFallback) {
    const scale = (options.dpi ?? 150) / 72;
    for (let p = 1; p <= numPages; p++) {
      options.onProgress?.(p - 1, numPages);
      const blob = await renderPdfPageToBlob(pdfDoc, p, scale, options.format, options.quality ?? 0.92);
      items.push({
        name: `${cleanBase}-page-${p}.${ext}`,
        blob,
      });
    }
  }

  options.onProgress?.(numPages, numPages);
  return { items, usedFallback };
}
