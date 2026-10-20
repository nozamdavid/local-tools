import { loadPdfjs } from '../../../lib/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface LoadPdfOptions {
  onPassword?: (verifyPassword: (password: string) => void, reason: number) => void;
}

export async function loadPdfDocument(
  file: File | Blob,
  options?: LoadPdfOptions
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
  });

  if (options?.onPassword) {
    loadingTask.onPassword = (verifyPassword: (password: string) => void, reason: number) => {
      options.onPassword!(verifyPassword, reason);
    };
  }

  return await loadingTask.promise;
}

export async function renderPdfThumbnail(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  maxDim: number = 160
): Promise<string> {
  const page = await pdfDoc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = maxDim / Math.max(unscaled.width, unscaled.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();

  return dataUrl;
}

export async function renderPdfPageToBlob(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  format: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number = 0.92
): Promise<Blob> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format, quality)
  );

  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();

  if (!blob) {
    throw new Error(`Failed to encode PDF page ${pageNumber} to ${format}`);
  }

  return blob;
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
  }
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
      const ops = await page.getOperatorList();

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === pdfjs.OPS.paintImageXObject) {
          const objId = ops.argsArray[i][0];
          try {
            const objs = typeof objId === 'string' && objId.startsWith('g_')
              ? (page as unknown as { commonObjs: { has(id: string): boolean; get(id: string, cb?: (res: unknown) => void): unknown } }).commonObjs
              : (page as unknown as { objs: { has(id: string): boolean; get(id: string, cb?: (res: unknown) => void): unknown } }).objs;

            let imgData: unknown = null;
            if (objs) {
              if (objs.has(objId)) {
                imgData = objs.get(objId);
              } else {
                imgData = await new Promise((resolve) => objs.get(objId, resolve));
              }
            }

            if (imgData && typeof imgData === 'object' && 'width' in imgData && 'height' in imgData) {
              const rawImg = imgData as {
                width: number;
                height: number;
                data?: Uint8ClampedArray | Uint8Array;
              };

              const canvas = document.createElement('canvas');
              canvas.width = rawImg.width;
              canvas.height = rawImg.height;
              const ctx = canvas.getContext('2d');

              if (ctx) {
                if (options.format === 'image/jpeg') {
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                if (
                  typeof ImageBitmap !== 'undefined' &&
                  rawImg instanceof ImageBitmap
                ) {
                  ctx.drawImage(rawImg, 0, 0);
                } else if (rawImg.data) {
                  const imgDataObj = ctx.createImageData(rawImg.width, rawImg.height);
                  imgDataObj.data.set(rawImg.data);
                  ctx.putImageData(imgDataObj, 0, 0);
                }

                const blob = await new Promise<Blob | null>((res) =>
                  canvas.toBlob(res, options.format, options.quality ?? 0.92)
                );
                canvas.width = 0;
                canvas.height = 0;

                if (blob) {
                  items.push({
                    name: `${cleanBase}-image-${imgIdx}.${ext}`,
                    blob,
                  });
                  imgIdx++;
                }
              }
            }
          } catch {
            // continue parsing other operators
          }
        }
      }

      page.cleanup();
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
      const blob = await renderPdfPageToBlob(
        pdfDoc,
        p,
        scale,
        options.format,
        options.quality ?? 0.92
      );
      items.push({
        name: `${cleanBase}-page-${p}.${ext}`,
        blob,
      });
    }
  }

  options.onProgress?.(numPages, numPages);
  return { items, usedFallback };
}
