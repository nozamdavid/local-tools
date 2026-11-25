import { describe, expect, it } from 'vitest';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { clearPdfMetadata } from './cleanMetadata';

const STANDARD_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];

async function makePdfFixture() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([640, 480]);
  page.setMediaBox(10, 20, 640, 480);
  page.setCropBox(30, 40, 580, 420);
  page.setBleedBox(25, 35, 590, 440);
  page.setTrimBox(35, 45, 570, 410);
  page.setArtBox(40, 50, 560, 400);
  page.setRotation(degrees(90));
  page.drawText('Searchable vector text', { x: 80, y: 360, size: 18, font, color: rgb(0, 0, 0) });

  doc.setTitle('Private title');
  doc.setAuthor('Private author');
  doc.setSubject('Private subject');
  doc.setKeywords(['private', 'metadata']);
  doc.setCreator('Private creator');
  doc.setProducer('Private producer');
  doc.setCreationDate(new Date('2024-01-02T03:04:05Z'));
  doc.setModificationDate(new Date('2024-02-03T04:05:06Z'));

  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
  if (!info) throw new Error('Fixture did not create an Info dictionary.');
  info.set(PDFName.of('CustomTag'), PDFString.of('keep custom Info'));

  const xmp = doc.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/">private xmp author</x:xmpmeta>', {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));

  return doc.save({ addDefaultPage: false, updateFieldAppearances: false });
}

function pageContentStreams(doc: PDFDocument): number[][] {
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return [];
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => doc.context.lookup(contents.get(index), PDFStream))
      : [contents];
  return streams.map((stream) => Array.from(stream.getContents()));
}

function xmpContent(doc: PDFDocument): number[] | undefined {
  const stream = doc.catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
  return stream ? Array.from(stream.getContents()) : undefined;
}

function pageStructure(page: ReturnType<PDFDocument['getPage']>) {
  return {
    media: page.getMediaBox(),
    crop: page.getCropBox(),
    bleed: page.getBleedBox(),
    trim: page.getTrimBox(),
    art: page.getArtBox(),
    rotation: page.getRotation().angle,
  };
}

describe('PDF metadata cleanup', () => {
  it('deletes standard Info keys and verifies them absent while preserving page streams, boxes, rotation, custom Info, and XMP', async () => {
    const sourceBytes = await makePdfFixture();
    const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    const sourceInfo = source.context.lookupMaybe(source.context.trailerInfo.Info, PDFDict);
    const sourcePage = source.getPage(0);
    const sourceContent = pageContentStreams(source);
    const sourceXmp = xmpContent(source);

    const cleaned = await clearPdfMetadata(sourceBytes);
    const output = await PDFDocument.load(cleaned.output, { updateMetadata: false });
    const outputInfo = output.context.lookupMaybe(output.context.trailerInfo.Info, PDFDict);
    const outputPage = output.getPage(0);

    expect(cleaned.removedFields).toEqual([
      'Title',
      'Author',
      'Subject',
      'Keywords',
      'Creator',
      'Producer',
      'Creation date',
      'Modification date',
    ]);
    expect(cleaned.remainingFields).toEqual([]);
    expect(output.getPageCount()).toBe(1);
    for (const key of STANDARD_KEYS) expect(outputInfo?.has(PDFName.of(key))).toBe(false);
    expect(outputInfo?.has(PDFName.of('CustomTag'))).toBe(true);
    expect(output.context.lookup(outputInfo?.get(PDFName.of('CustomTag')), PDFString).decodeText()).toBe('keep custom Info');

    expect(pageContentStreams(output)).toEqual(sourceContent);
    expect(pageStructure(outputPage)).toEqual(pageStructure(sourcePage));
    expect(xmpContent(output)).toEqual(sourceXmp);
    expect(cleaned.xmpMetadataPresentBefore).toBe(true);
    expect(cleaned.xmpMetadataPresent).toBe(true);
    expect(sourceInfo?.has(PDFName.of('Title'))).toBe(true);
  });

  it('rejects malformed PDFs with a readable error', async () => {
    await expect(clearPdfMetadata(Uint8Array.from([0, 1, 2, 3]))).rejects.toThrow('Could not read this PDF:');
  });

  it('rejects encrypted PDFs instead of loading them with encryption ignored', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    const encryptionDictionary = doc.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: PDFString.of('fixture-owner'),
      U: PDFString.of('fixture-user'),
      P: -4,
    });
    doc.context.trailerInfo.Encrypt = doc.context.register(encryptionDictionary);
    const encryptedMarkerPdf = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });

    await expect(clearPdfMetadata(encryptedMarkerPdf)).rejects.toThrow('password protected');
  });
});
