import { PDFDocument } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import { loadPdfDocument, renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';

export const STAMP_PREVIEW_MAX_DIMENSION = 900;

/** Saves an edited PDF copy and rasterizes only the requested page for an in-tool preview. */
export async function renderEditedPdfPage(
  loadForEditing: () => Promise<PDFDocument>,
  pageNumber: number,
  annotate: (pdf: PDFDocument, page: PDFPage) => void | Promise<void>,
  isStale: () => boolean = () => false,
  signal?: AbortSignal,
): Promise<string> {
  const sourcePdf = await loadForEditing();
  if (isStale()) throw new Error('Preview cancelled.');
  if (!sourcePdf.getPages()[pageNumber - 1]) throw new Error('The selected page is not available.');
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const [page] = await pdf.copyPages(sourcePdf, [pageNumber - 1]);
  if (isStale()) throw new Error('Preview cancelled.');
  pdf.addPage(page);
  await annotate(pdf, page);
  if (isStale()) throw new Error('Preview cancelled.');
  const bytes = await pdf.save();
  if (isStale()) throw new Error('Preview cancelled.');
  const renderedPdf = await loadPdfDocument(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  try {
    if (isStale()) throw new Error('Preview cancelled.');
    return await renderPdfThumbnail(renderedPdf, 1, STAMP_PREVIEW_MAX_DIMENSION, signal);
  } finally {
    await renderedPdf.loadingTask.destroy();
  }
}
