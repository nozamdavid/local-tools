import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface SyntheticComparePdfs {
  fileA: File;
  fileB: File;
  bytesA: Uint8Array;
  bytesB: Uint8Array;
}

/**
 * Creates two small synthetic PDFs with changed lines on page 1 and a missing/deleted page 2.
 */
export async function createSyntheticComparePdfs(): Promise<SyntheticComparePdfs> {
  // Document A: 3 pages
  const docA = await PDFDocument.create();
  const fontA = await docA.embedFont(StandardFonts.Helvetica);

  // Page 1
  const p1A = docA.addPage([500, 400]);
  p1A.drawText('Quarterly Financial Report', { x: 50, y: 350, size: 16, font: fontA, color: rgb(0, 0, 0) });
  p1A.drawText('Revenue grew by 15% this quarter.', { x: 50, y: 310, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });
  p1A.drawText('Operating costs remained stable at $4.2M.', { x: 50, y: 280, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });
  p1A.drawText('Customer retention reached an all-time high.', { x: 50, y: 250, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });

  // Page 2 (will be missing in docB)
  const p2A = docA.addPage([500, 400]);
  p2A.drawText('Regional Operations Overview', { x: 50, y: 350, size: 16, font: fontA, color: rgb(0, 0, 0) });
  p2A.drawText('North America accounted for 55% of volume.', { x: 50, y: 310, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });
  p2A.drawText('Europe delivered 30% of active volume.', { x: 50, y: 280, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });

  // Page 3
  const p3A = docA.addPage([500, 400]);
  p3A.drawText('Conclusion and Outlook', { x: 50, y: 350, size: 16, font: fontA, color: rgb(0, 0, 0) });
  p3A.drawText('Projected next quarter growth is 12%.', { x: 50, y: 310, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });
  p3A.drawText('Strategic roadmap execution remains fully on track.', { x: 50, y: 280, size: 12, font: fontA, color: rgb(0.2, 0.2, 0.2) });

  const bytesA = await docA.save();
  const fileA = new File([bytesA as BlobPart], 'report-v1.pdf', { type: 'application/pdf' });

  // Document B: 2 pages (page 2 deleted, page 1 changed)
  const docB = await PDFDocument.create();
  const fontB = await docB.embedFont(StandardFonts.Helvetica);

  // Page 1 with modified lines
  const p1B = docB.addPage([500, 400]);
  p1B.drawText('Quarterly Financial Report', { x: 50, y: 350, size: 16, font: fontB, color: rgb(0, 0, 0) });
  p1B.drawText('Revenue grew by 22% this quarter with enterprise gains.', { x: 50, y: 310, size: 12, font: fontB, color: rgb(0.2, 0.2, 0.2) });
  p1B.drawText('Operating costs increased slightly to $4.8M.', { x: 50, y: 280, size: 12, font: fontB, color: rgb(0.2, 0.2, 0.2) });
  p1B.drawText('Customer retention reached an all-time high.', { x: 50, y: 250, size: 12, font: fontB, color: rgb(0.2, 0.2, 0.2) });

  // Page 2 corresponds to Page 3 of docA with an update
  const p2B = docB.addPage([500, 400]);
  p2B.drawText('Conclusion and Outlook', { x: 50, y: 350, size: 16, font: fontB, color: rgb(0, 0, 0) });
  p2B.drawText('Projected next quarter growth is revised to 18%.', { x: 50, y: 310, size: 12, font: fontB, color: rgb(0.2, 0.2, 0.2) });
  p2B.drawText('Strategic roadmap execution remains fully on track.', { x: 50, y: 280, size: 12, font: fontB, color: rgb(0.2, 0.2, 0.2) });

  const bytesB = await docB.save();
  const fileB = new File([bytesB as BlobPart], 'report-v2.pdf', { type: 'application/pdf' });

  return { fileA, fileB, bytesA, bytesB };
}

/**
 * Creates an image-only / empty text PDF with no font or text operators.
 */
export async function createEmptyScannedPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 400]);
  // Draw a filled rectangle only (no text)
  page.drawRectangle({
    x: 40,
    y: 40,
    width: 420,
    height: 320,
    color: rgb(0.9, 0.9, 0.9),
  });
  const bytes = await doc.save();
  return new File([bytes as BlobPart], 'scanned-blank.pdf', { type: 'application/pdf' });
}
