import { PDFArray, PDFDict, PDFName, PDFObjectCopier, PDFPage, PDFPageLeaf, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';
import { decryptPdf, QpdfError } from '../_qpdf/qpdf';
import { translate } from '../../../lib/i18n';

export const ENCRYPTED_MESSAGE = 'This PDF is password protected. Enter the password to open it.';

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
  const { PDFDocument, EncryptedPDFError } = await import('pdf-lib');
  let bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { bytes, doc, pageCount: doc.getPageCount() };
  } catch (err) {
    const isEncrypted = err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/i.test(err.message));
    if (!isEncrypted) {
      throw new Error(
        translate('Could not read this PDF: {message}', { message: err instanceof Error ? err.message : 'the file may be damaged.' }),
        { cause: err },
      );
    }

    try {
      const decrypted = await decryptPdf(bytes, password ?? '');
      bytes = new Uint8Array(decrypted);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      return { bytes, doc, pageCount: doc.getPageCount() };
    } catch (decryptErr) {
      if (decryptErr instanceof QpdfError && decryptErr.badPassword) {
        throw password === undefined ? new PasswordRequiredError() : new IncorrectPasswordError();
      }
      throw decryptErr;
    }
  }
}

/**
 * Removes dangling link annotations from kept pages that point to deleted pages,
 * preventing pdf-lib from recursively pulling in deleted page content trees.
 * The returned function restores the original annotations for subsequent exports.
 */
export function cleanDanglingLinks(doc: PDFDocument, keptIndices: number[]): () => void {
  const allPages = doc.getPages();
  const keptSet = new Set(keptIndices);
  const deletedRefs = new Set(allPages.filter((_, i) => !keptSet.has(i)).map((p) => p.ref));
  const restore: Array<() => void> = [];
  const annotsKey = PDFName.of('Annots');

  if (deletedRefs.size === 0) return () => {};

  for (const idx of keptSet) {
    const node = allPages[idx]?.node;
    const original = node?.get(annotsKey);
    const annots = doc.context.lookup(original);
    if (!node || !original || !(annots instanceof PDFArray)) continue;

    const keptAnnots = annots.asArray().filter((ref) => {
      const annot = doc.context.lookup(ref);
      if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype')) !== PDFName.of('Link')) return true;

      const action = annot.lookup(PDFName.of('A'));
      const directDest = annot.lookup(PDFName.of('Dest'));
      const actionDest = action instanceof PDFDict ? action.lookup(PDFName.of('D')) : undefined;
      const pointsToDeletedPage = (dest: PDFObject | undefined) => {
        const target = dest instanceof PDFArray ? dest.get(0) : undefined;
        return target instanceof PDFRef && deletedRefs.has(target);
      };
      return !pointsToDeletedPage(directDest) && !pointsToDeletedPage(actionDest);
    });

    if (keptAnnots.length === annots.size()) continue;
    restore.push(() => node.set(annotsKey, original));
    if (keptAnnots.length > 0) node.set(annotsKey, doc.context.obj(keptAnnots));
    else node.delete(annotsKey);
  }

  return () => restore.forEach((restorePage) => restorePage());
}

/** Copies selected pages while keeping their references consistent inside the new document. */
export async function copySelectedPages(src: PDFDocument, indices: number[], target: PDFDocument): Promise<PDFPage[]> {
  await src.flush();
  const selected = new Set(indices);
  const omitted = src.getPages().filter((_, index) => !selected.has(index));
  const restoreLinks = cleanDanglingLinks(src, indices);

  try {
    // References can also reach omitted pages through shared form fields and annotations.
    // Keep those page objects out of the copier's lookup until the synchronous copy finishes.
    for (const page of omitted) src.context.delete(page.ref);
    const copier = PDFObjectCopier.for(src.context, target.context);
    const copiedRefs = new Set<PDFRef>();
    return indices.map((index) => {
      const ref = copier.copy(src.getPage(index).ref);
      const node = target.context.lookup(ref);
      if (!(node instanceof PDFPageLeaf)) throw new Error('Could not copy the selected PDF page.');
      if (copiedRefs.has(ref)) {
        const duplicate = node.clone();
        return PDFPage.of(duplicate, target.context.register(duplicate), target);
      }
      copiedRefs.add(ref);
      return PDFPage.of(node, ref, target);
    });
  } finally {
    for (const page of omitted) src.context.assign(page.ref, page.node);
    restoreLinks();
  }
}

/** Builds a new PDF from the given 1-based page numbers of `src`, in the order given. */
export async function copyPagesToPdf(src: PDFDocument, pageNumbers: number[], out?: PDFDocument): Promise<PDFDocument> {
  const { PDFDocument } = await import('pdf-lib');
  const target = out ?? (await PDFDocument.create());
  const pages = await copySelectedPages(
    src,
    pageNumbers.map((n) => n - 1),
    target,
  );
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
  if (tokens.length === 0) throw new Error(translate('Enter at least one page or range, for example 1-3, 5, 7-9.'));

  return tokens.map((token) => {
    const m = /^(\d+)(?:\s*[-\u2013]\s*(\d*))?$/.exec(token);
    if (!m) throw new Error(translate('"{token}" is not a valid page or range.', { token }));

    const from = Number(m[1]);
    const hasDash = token.includes('-') || token.includes('\u2013');
    const to = !hasDash ? from : m[2] ? Number(m[2]) : pageCount;

    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new Error(translate('"{token}" is outside the document (1-{pageCount}).', { token, pageCount }));
    }
    if (from > to) throw new Error(translate('"{token}" runs backwards. Write it as {to}-{from}.', { token, to, from }));
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
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
