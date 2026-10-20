import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPdfPageToBlob } from '../../image/_pdf/pdfRenderer';

const MAX_PIXELS = 6000;

export interface RasterizeOptions {
  dpi: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
  onProgress?: (ratio: number) => void;
}

/**
 * Renders every page with pdf.js and rebuilds a PDF from JPEG page images (pdf-lib).
 * The result has no selectable text.
 */
export async function rasterizePdf(doc: PDFDocumentProxy, options: RasterizeOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();

  for (let n = 1; n <= doc.numPages; n++) {
    options.onProgress?.((n - 1) / doc.numPages);

    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    page.cleanup();

    const scale = Math.min(options.dpi / 72, MAX_PIXELS / Math.max(width, height));
    const jpeg = await renderPdfPageToBlob(doc, n, scale, 'image/jpeg', options.quality);
    const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));

    const target = out.addPage([width, height]);
    target.drawImage(image, { x: 0, y: 0, width, height });
  }

  options.onProgress?.(1);
  return out.save();
}
