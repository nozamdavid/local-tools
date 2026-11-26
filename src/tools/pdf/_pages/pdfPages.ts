import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
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

/** Copies form field roots for the selected widgets, omitting their discarded siblings. */
function copySelectedFormFields(
  src: PDFDocument,
  pages: PDFPage[],
  target: PDFDocument,
  copier: PDFObjectCopier,
  restore: Array<() => void>,
): void {
  const sourceForm = src.catalog.getAcroForm();
  const fields = sourceForm?.Fields();
  if (!sourceForm || !fields) return;

  const kept = new Set<PDFDict>();
  const parentKey = PDFName.of('Parent');
  const subtypeKey = PDFName.of('Subtype');
  for (const page of pages) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      let node = src.context.lookup(ref);
      if (!(node instanceof PDFDict) || node.get(subtypeKey) !== PDFName.of('Widget')) continue;
      while (node instanceof PDFDict && !kept.has(node)) {
        kept.add(node);
        node = node.lookup(parentKey);
      }
    }
  }

  const isKept = (ref: PDFObject) => {
    const node = src.context.lookup(ref);
    return node instanceof PDFDict && kept.has(node);
  };
  const roots = fields.asArray().filter(isKept);
  if (roots.length === 0) return;

  const kidsKey = PDFName.of('Kids');
  for (const node of kept) {
    const original = node.get(kidsKey);
    const kids = src.context.lookup(original);
    if (!original || !(kids instanceof PDFArray)) continue;
    const children = kids.asArray().filter(isKept);
    if (children.length === kids.size()) continue;
    node.set(kidsKey, src.context.obj(children));
    restore.push(() => node.set(kidsKey, original));
  }

  const outputForm = target.catalog.getOrCreateAcroForm();
  const outputFields = outputForm.normalizedEntries().Fields;
  const nameKey = PDFName.of('T');
  const getRootName = (root: PDFObject) => {
    const field = target.context.lookup(root);
    const name = field instanceof PDFDict ? field.lookup(nameKey) : undefined;
    return name instanceof PDFString || name instanceof PDFHexString ? name.decodeText() : undefined;
  };
  const copiedRoots = roots.map((root) => copier.copy(root));
  const usedNames = new Set(outputFields.asArray().map(getRootName));
  const incomingNames = new Set(copiedRoots.map(getRootName));
  for (const root of copiedRoots) {
    let name = getRootName(root);
    if (name && usedNames.has(name)) {
      const originalName = name;
      let suffix = 2;
      // Leave other incoming roots free to keep their original names.
      do {
        name = `${originalName}_${suffix++}`;
      } while (usedNames.has(name) || incomingNames.has(name));
      target.context.lookup(root, PDFDict).set(nameKey, PDFHexString.fromText(name));
    }
    usedNames.add(name);
    outputFields.push(root);
  }
  for (const name of ['DA', 'DR', 'Q', 'NeedAppearances']) {
    const key = PDFName.of(name);
    const value = sourceForm.dict.get(key);
    if (value && !outputForm.dict.has(key)) outputForm.dict.set(key, copier.copy(value));
  }
}

/** Copies selected pages while keeping their references consistent inside the new document. */
export async function copySelectedPages(src: PDFDocument, indices: number[], target: PDFDocument): Promise<PDFPage[]> {
  await src.flush();
  const selected = new Set(indices);
  const omitted = src.getPages().filter((_, index) => !selected.has(index));
  const restoreLinks = cleanDanglingLinks(src, indices);
  const restoreFields: Array<() => void> = [];

  try {
    // References can also reach omitted pages through shared form fields and annotations.
    // Keep those page objects out of the copier's lookup until the synchronous copy finishes.
    for (const page of omitted) src.context.delete(page.ref);
    const copier = PDFObjectCopier.for(src.context, target.context);
    const pages = indices.map((index) => src.getPage(index));
    copySelectedFormFields(src, pages, target, copier, restoreFields);
    const copiedRefs = new Set<PDFRef>();
    return pages.map((page) => {
      const ref = copier.copy(page.ref);
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
    for (const restore of restoreFields) restore();
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
    .replace(/[ \t]*([-\u2013])[ \t]*/g, '$1')
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (tokens.length === 0) throw new Error(translate('Enter at least one page or range, for example 1-3, 5, 7-9.'));

  return tokens.map((token) => {
    const m = /^(\d+)(?:[-\u2013](\d*))?$/.exec(token);
    if (!m) throw new Error(translate('"{token}" is not a valid page or range.', { token }));

    const from = Number(m[1]);
    const to = m[2] === undefined ? from : m[2] === '' ? pageCount : Number(m[2]);

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
