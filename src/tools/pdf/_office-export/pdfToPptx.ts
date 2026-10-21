import pptxgen from 'pptxgenjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PptxOptions {
  /** Rendering scale factor (defaults to 2 for crisp slides). */
  scale?: number;
  /** Image quality between 0.1 and 1.0 (defaults to 0.88). */
  quality?: number;
  /** Optional custom image generator per page, returning a data URL (used in headless/test environments). */
  renderPageImage?: (pageNumber: number) => Promise<string>;
}

export async function pdfToPptx(doc: PDFDocumentProxy, options?: PptxOptions, onProgress?: (ratio: number) => void): Promise<Blob> {
  const numPages = doc.numPages;
  const pptx = new pptxgen();

  const scale = options?.scale ?? 2.0;
  const quality = options?.quality ?? 0.88;

  for (let p = 1; p <= numPages; p++) {
    onProgress?.((p - 1) / numPages);

    const page = await doc.getPage(p);
    const unscaled = page.getViewport({ scale: 1 });

    if (p === 1) {
      const widthIn = unscaled.width / 72;
      const heightIn = unscaled.height / 72;
      pptx.defineLayout({ name: 'PDF_PAGE', width: widthIn, height: heightIn });
      pptx.layout = 'PDF_PAGE';
    }

    let dataUrl: string;
    if (options?.renderPageImage) {
      dataUrl = await options.renderPageImage(p);
    } else {
      if (typeof document === 'undefined') {
        throw new Error('Canvas rendering requires a browser environment.');
      }
      const renderScale = Math.min(scale, 2048 / Math.max(unscaled.width, unscaled.height));
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        throw new Error('Canvas 2D context unavailable');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      dataUrl = canvas.toDataURL('image/jpeg', quality);

      canvas.width = 0;
      canvas.height = 0;
    }

    page.cleanup();

    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: '100%', h: '100%' });
  }

  onProgress?.(0.95);
  const buffer = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  onProgress?.(1);

  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
