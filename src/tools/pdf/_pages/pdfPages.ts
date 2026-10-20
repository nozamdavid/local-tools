import { PDFDocument, EncryptedPDFError, PDFName, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import { decryptPdf, QpdfError } from '../_qpdf/qpdf';

export const ENCRYPTED_MESSAGE =
  'This PDF is password protected. Enter the password to open it.';

export interface OpenedPdf {
  bytes: Uint8Array;
  doc: PDFDocument;
  pageCount: number;
}

export class PasswordRequiredError extends Error {
  readonly isEncrypted = true;
  constructor(message = ENCRYPTED_MESSAGE) {
    super(message);
    this.name = 'PasswordRequiredError';
  }
}

export class IncorrectPasswordError extends Error {
  readonly badPassword = true;
  constructor(message = 'Incorrect password. Please try again.') {
    super(message);
    this.name = 'IncorrectPasswordError';
  }
}

/** Reads a PDF with pdf-lib. Decrypts with worker qpdf when password-protected. */
export async function openPdf(file: File | Blob, password?: string): Promise<OpenedPdf> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { bytes, doc, pageCount: doc.getPageCount() };
  } catch (err) {
    const isEncrypted =
      err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/i.test(err.message));
    if (!isEncrypted) {
      throw new Error(
        `Could not read this PDF: ${err instanceof Error ? err.message : 'the file may be damaged.'}`
      );
    }

    if (password === undefined) {
      throw new PasswordRequiredError();
    }

    try {
      const decrypted = await decryptPdf(bytes, password);
      bytes = new Uint8Array(decrypted);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      return { bytes, doc, pageCount: doc.getPageCount() };
    } catch (decryptErr) {
      if (decryptErr instanceof QpdfError && decryptErr.badPassword) {
        throw new IncorrectPasswordError();
      }
      if (decryptErr instanceof Error && /invalid password/i.test(decryptErr.message)) {
        throw new IncorrectPasswordError();
      }
      throw decryptErr;
    }
  }
}

/**
 * Removes dangling link annotations from kept pages that point to deleted pages,
 * preventing pdf-lib from recursively pulling in deleted page content trees.
 */
export function cleanDanglingLinks(doc: PDFDocument, keptIndices: number[]): void {
  const allPages = doc.getPages();
  const keptSet = new Set(keptIndices);
  const deletedRefs = new Set(
    allPages.filter((_, i) => !keptSet.has(i)).map((p) => p.ref)
  );

  if (deletedRefs.size === 0) return;

  for (const idx of keptIndices) {
    if (idx < 0 || idx >= allPages.length) continue;
    const page = allPages[idx];
    const annotsRef = page.node.get(PDFName.of('Annots'));
    const annots = doc.context.lookup(annotsRef);
    if (!(annots instanceof PDFArray)) continue;

    const keptAnnots: (PDFRef | PDFDict)[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      const annot = doc.context.lookup(annotRef);
      if (!(annot instanceof PDFDict)) {
        keptAnnots.push(annotRef as PDFRef | PDFDict);
        continue;
      }
      if (annot.get(PDFName.of('Subtype'))?.toString() !== '/Link') {
        keptAnnots.push(annotRef as PDFRef | PDFDict);
        continue;
      }

      let targetRef: unknown = null;
      const dest = doc.context.lookup(annot.get(PDFName.of('Dest')));
      if (dest instanceof PDFArray && dest.size() > 0) {
        targetRef = dest.get(0);
      } else {
        const action = doc.context.lookup(annot.get(PDFName.of('A')));
        if (action instanceof PDFDict) {
          const actionDest = doc.context.lookup(action.get(PDFName.of('D')));
          if (actionDest instanceof PDFArray && actionDest.size() > 0) {
            targetRef = actionDest.get(0);
          }
        }
      }

      if (targetRef instanceof PDFRef && deletedRefs.has(targetRef)) {
        // Dangling link pointing to a deleted page. Omit it so the deleted page content object is not copied.
      } else {
        keptAnnots.push(annotRef as PDFRef | PDFDict);
      }
    }

    if (keptAnnots.length === 0) {
      page.node.delete(PDFName.of('Annots'));
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj(keptAnnots));
    }
  }
}

/** Builds a new PDF from the given 1-based page numbers of `src`, in the order given. */
export async function copyPagesToPdf(
  src: PDFDocument,
  pageNumbers: number[],
  out?: PDFDocument
): Promise<PDFDocument> {
  const target = out ?? (await PDFDocument.create());
  const zeroIndexed = pageNumbers.map((n) => n - 1);
  cleanDanglingLinks(src, zeroIndexed);
  const pages = await target.copyPages(src, zeroIndexed);
  pages.forEach((p) => target.addPage(p));
  return target;
}

export async function pdfToBlob(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '') || 'document';
}

/**
 * Parses "1-3, 5, 7-" into a list of inclusive [from, to] ranges (1-based).
 * Throws an Error with a user-readable message when the text is invalid.
 */
export function parseRanges(text: string, pageCount: number): [number, number][] {
  const tokens = text
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error('Enter at least one page or range, for example 1-3, 5, 7-9.');

  return tokens.map((token) => {
    const m = /^(\d+)(?:\s*[-\u2013]\s*(\d*))?$/.exec(token);
    if (!m) throw new Error(`"${token}" is not a valid page or range.`);

    const from = Number(m[1]);
    const hasDash = token.includes('-') || token.includes('\u2013');
    const to = !hasDash ? from : m[2] ? Number(m[2]) : pageCount;

    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new Error(`"${token}" is outside the document (1-${pageCount}).`);
    }
    if (from > to) throw new Error(`"${token}" runs backwards. Write it as ${to}-${from}.`);
    return [from, to];
  });
}

export function expandRange([from, to]: [number, number]): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Turns a set of pages into compact text such as "1-3, 5, 7-9". */
export function formatPages(pages: Iterable<number>): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
