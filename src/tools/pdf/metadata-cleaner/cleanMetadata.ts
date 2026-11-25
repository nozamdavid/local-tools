import { EncryptedPDFError, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { translate } from '../../../lib/i18n';

const INFO_FIELDS = [
  { key: 'Title', label: 'Title' },
  { key: 'Author', label: 'Author' },
  { key: 'Subject', label: 'Subject' },
  { key: 'Keywords', label: 'Keywords' },
  { key: 'Creator', label: 'Creator' },
  { key: 'Producer', label: 'Producer' },
  { key: 'CreationDate', label: 'Creation date' },
  { key: 'ModDate', label: 'Modification date' },
] as const;

export type StandardInfoField = (typeof INFO_FIELDS)[number]['label'];

export interface PdfMetadataInspection {
  fields: StandardInfoField[];
  xmpMetadataPresent: boolean;
  pageCount: number;
}

export interface PdfMetadataCleanup {
  output: Uint8Array;
  removedFields: StandardInfoField[];
  remainingFields: StandardInfoField[];
  xmpMetadataPresent: boolean;
  xmpMetadataPresentBefore: boolean;
  pageCount: number;
}

async function readBytes(file: Blob | Uint8Array): Promise<Uint8Array> {
  return file instanceof Uint8Array ? file.slice() : new Uint8Array(await file.arrayBuffer());
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError || (error instanceof Error && /is encrypted/i.test(error.message))) {
      throw new Error(translate('This PDF is password protected. Remove its password with the Unlock PDF tool first.'), { cause: error });
    }
    const detail = error instanceof Error ? error.message : 'the file may be damaged.';
    throw new Error(translate('Could not read this PDF: {detail}', { detail }), { cause: error });
  }
}

function readStandardInfoFields(doc: PDFDocument): StandardInfoField[] {
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
  if (!info) return [];
  return INFO_FIELDS.filter(({ key }) => info.has(PDFName.of(key))).map(({ label }) => label);
}

function getXmpStream(doc: PDFDocument): PDFStream | undefined {
  return doc.catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

export async function inspectPdfMetadata(file: Blob | Uint8Array): Promise<PdfMetadataInspection> {
  const doc = await loadPdf(await readBytes(file));
  return {
    fields: readStandardInfoFields(doc),
    xmpMetadataPresent: getXmpStream(doc) !== undefined,
    pageCount: doc.getPageCount(),
  };
}

export async function clearPdfMetadata(file: Blob | Uint8Array): Promise<PdfMetadataCleanup> {
  const doc = await loadPdf(await readBytes(file));
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
  const fieldsBefore = readStandardInfoFields(doc);
  const xmpBefore = getXmpStream(doc)?.getContents();

  if (info) {
    for (const { key } of INFO_FIELDS) info.delete(PDFName.of(key));
  }

  // Do not add a page to an empty source or rewrite form appearances as a side effect.
  const output = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
  const verified = await loadPdf(output);
  const remainingFields = readStandardInfoFields(verified);
  if (remainingFields.length > 0) {
    throw new Error(translate('Could not verify removal of these standard fields: {fields}.', { fields: remainingFields.join(', ') }));
  }

  const xmpAfter = getXmpStream(verified)?.getContents();
  if (xmpBefore && (!xmpAfter || !equalBytes(xmpBefore, xmpAfter))) {
    throw new Error(translate('Could not verify that the source XMP metadata stream was retained. No output file was created.'));
  }

  return {
    output,
    removedFields: fieldsBefore,
    remainingFields,
    xmpMetadataPresent: xmpAfter !== undefined,
    xmpMetadataPresentBefore: xmpBefore !== undefined,
    pageCount: verified.getPageCount(),
  };
}
