import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFormat } from './detect';

async function fileFromZip(zip: JSZip, name: string): Promise<File> {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes.slice().buffer as ArrayBuffer], name);
}

describe('detectFormat office documents', () => {
  it('detects ODF packages from the ZIP mimetype entry', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    const file = await fileFromZip(zip, 'report.odt');

    await expect(detectFormat(file)).resolves.toMatchObject({ id: 'odt', family: 'document', extensionMismatch: false });
  });

  it('detects flat ODF from its office namespace and body element', async () => {
    const xml =
      '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><office:spreadsheet/></office:body></office:document>';
    const file = new File([xml], 'sheet.fods');

    await expect(detectFormat(file)).resolves.toMatchObject({ id: 'fods', family: 'document', extensionMismatch: false });

    const unrelatedXml = await detectFormat(new File(['<root><text>plain XML</text></root>'], 'plain.fodt'));
    expect(unrelatedXml.id).not.toBe('fodt');
  });

  it('requires the Word document entry before identifying a ZIP as DOCX', async () => {
    const docxZip = new JSZip();
    docxZip.file('word/document.xml', '<w:document/>');
    const docx = await fileFromZip(docxZip, 'report.docx');
    await expect(detectFormat(docx)).resolves.toMatchObject({ id: 'docx', family: 'document' });

    const unrelatedZip = new JSZip();
    unrelatedZip.file('notes.txt', 'not a Word document');
    for (const extension of ['docx', 'xlsx', 'ods', 'epub']) {
      const renamed = await fileFromZip(unrelatedZip, `renamed.${extension}`);
      const detected = await detectFormat(renamed);
      expect(detected.family).toBe('unknown');
      expect(['docx', 'xlsx', 'ods', 'epub']).not.toContain(detected.id);
    }
  });

  it('recognizes an OLE legacy document and leaves generic CFB subtype unknown', async () => {
    const signature = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const signatureBuffer = signature.slice().buffer as ArrayBuffer;
    const legacy = new File([signatureBuffer], 'legacy.doc');
    await expect(detectFormat(legacy)).resolves.toMatchObject({ id: 'doc', family: 'document', extensionMismatch: false });

    const generic = await detectFormat(new File([signatureBuffer], 'container.cfb'));
    expect(generic.id).toBe('cfb');
    expect(generic.extensionMismatch).toBe(false);
  });

  it.each([
    ['single.csv', 'one,two', 'csv'],
    ['single.tsv', 'one\ttwo', 'tsv'],
  ])('uses the delimited text extension for a single row in %s', async (filename, content, id) => {
    await expect(detectFormat(new File([content], filename))).resolves.toMatchObject({ id, family: 'text' });
  });

  it('recognizes plain text that starts with PK and crosses the sample boundary in a UTF-8 character', async () => {
    const text = `PK${' '.repeat(8189)}é`;
    await expect(detectFormat(new File([text], 'notes.txt'))).resolves.toMatchObject({ id: 'txt', family: 'text' });
  });

  it('handles a short file without throwing', async () => {
    const shortBuffer = new Uint8Array([0]).buffer as ArrayBuffer;
    await expect(detectFormat(new File([shortBuffer], 'short.bin'))).resolves.toMatchObject({ id: 'unknown', family: 'unknown' });
  });
});
