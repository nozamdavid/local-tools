import { degrees, PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { mapVisualToPdf } from '../_stamp/coords';
import type { RedactionBox } from './types';
import { translate } from '../../../lib/i18n';

export interface RedactOptions {
  dpi?: number;
  quality?: number;
  onProgress?: (ratio: number) => void;
}

const MAX_PIXELS = 4096;

/**
 * Permanently redacts sensitive content from a PDF document:
 * 1. Renders pages to canvas.
 * 2. Burns opaque redaction boxes directly into the pixel data.
 * 3. Builds a completely new PDF document (using PDFDocument.create()) with zero
 *    source objects, zero original metadata, and zero source attachments.
 * 4. Preserves page dimensions and rotation mapping.
 */
export async function redactPdf(doc: PDFDocumentProxy, redactions: RedactionBox[], options?: RedactOptions): Promise<Uint8Array> {
  const dpi = options?.dpi ?? 150;
  const quality = options?.quality ?? 0.92;
  const onProgress = options?.onProgress;

  const outPdf = await PDFDocument.create();

  // Group redactions by page number (1-based)
  const byPage = new Map<number, RedactionBox[]>();
  for (const box of redactions) {
    const list = byPage.get(box.pageNum) ?? [];
    list.push(box);
    byPage.set(box.pageNum, list);
  }

  const numPages = doc.numPages;

  for (let pNum = 1; pNum <= numPages; pNum++) {
    onProgress?.((pNum - 1) / numPages);

    const page = await doc.getPage(pNum);
    const unscaled = page.getViewport({ scale: 1 });
    const visualWidth = unscaled.width;
    const visualHeight = unscaled.height;

    const scale = Math.min(dpi / 72, MAX_PIXELS / Math.max(visualWidth, visualHeight));
    const viewport = page.getViewport({ scale });

    // Render page to canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      page.cleanup();
      throw new Error('Canvas 2D rendering context is unavailable.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    page.cleanup();

    // Cover every raster pixel touched by the selected area.
    const pageRedactions = byPage.get(pNum) ?? [];
    for (const box of pageRedactions) {
      const left = Math.floor((box.xPercent / 100) * viewport.width);
      const top = Math.floor((box.yTopPercent / 100) * viewport.height);
      const right = Math.ceil(((box.xPercent + box.widthPercent) / 100) * viewport.width);
      const bottom = Math.ceil(((box.yTopPercent + box.heightPercent) / 100) * viewport.height);

      ctx.fillStyle = box.color === '#ffffff' ? '#ffffff' : '#000000';
      ctx.fillRect(left, top, right - left, bottom - top);
    }

    // Convert rasterized canvas to JPEG
    const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    canvas.width = 0;
    canvas.height = 0;

    if (!jpegBlob) {
      throw new Error(translate('Failed to encode rasterized page {page} to JPEG.', { page: pNum }));
    }

    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const embeddedImage = await outPdf.embedJpg(jpegBytes);

    // Compute original unrotated PDF dimensions and rotation angle
    const rawAngle = page.rotate;
    const rotation = ((rawAngle % 360) + 360) % 360;
    const isSideways = rotation === 90 || rotation === 270;
    const pdfWidth = isSideways ? visualHeight : visualWidth;
    const pdfHeight = isSideways ? visualWidth : visualHeight;

    const dims = {
      pdfWidth,
      pdfHeight,
      visualWidth,
      visualHeight,
      rotation,
    };

    const newPage = outPdf.addPage([pdfWidth, pdfHeight]);
    if (rotation !== 0) {
      newPage.setRotation(degrees(rotation));
    }

    const placement = mapVisualToPdf({ x: 0, y: 0, angle: 0 }, dims);
    newPage.drawImage(embeddedImage, {
      x: placement.x,
      y: placement.y,
      width: visualWidth,
      height: visualHeight,
      rotate: degrees(placement.rotateDegrees),
    });
  }

  onProgress?.(1);
  return await outPdf.save();
}
