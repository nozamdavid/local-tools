import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertOfficeDocument } from './office';

const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

function asFile(bytes: string | Uint8Array, name: string): File {
  const part = typeof bytes === 'string' ? bytes : (bytes.slice().buffer as ArrayBuffer);
  const blob = new Blob([part]);
  Object.defineProperty(blob, 'name', { value: name });
  return blob as File;
}

async function odfPackage(content: string, name = 'test.odt'): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', content);
  return asFile(await zip.generateAsync({ type: 'uint8array' }), name);
}

async function spreadsheetPackage(content: string): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
  zip.file('content.xml', content);
  return asFile(await zip.generateAsync({ type: 'uint8array' }), 'sheet.ods');
}

function centralDirectoryOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return view.getUint32(i + 16, true);
  }
  throw new Error('test ZIP is missing EOCD');
}

function alterCentralEntry(bytes: Uint8Array, change: (view: DataView, entryOffset: number) => void): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let cursor = centralDirectoryOffset(copy);
  while (view.getUint32(cursor, true) === 0x02014b50) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    change(view, cursor);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return copy;
}

describe('office document conversion', () => {
  it('extracts paragraph text from a packaged ODF document and flat XML with alternate prefixes', async () => {
    const packaged = await odfPackage(
      `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:text="${TEXT_NS}"><office:body><office:text><text:p>Packaged text</text:p></office:text></office:body></office:document-content>`,
    );
    const packagedText = await convertOfficeDocument(packaged, 'odt', 'txt');
    expect(await packagedText.text()).toBe('Packaged text');

    const flatXml = `<f:document xmlns:f="${OFFICE_NS}" xmlns:q="${TEXT_NS}"><f:body><f:text><q:p>Flat <q:span>text</q:span></q:p><q:p>Next paragraph</q:p></f:text></f:body></f:document>`;
    const flat = asFile(flatXml, 'flat.fodt');
    const flatText = await convertOfficeDocument(flat, 'fodt', 'txt');
    expect(await flatText.text()).toBe('Flat text\n\nNext paragraph');
  });

  it('expands repeated spreadsheet rows and cells, keeps cached types, and quotes delimited text', async () => {
    const content = `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:text="${TEXT_NS}" xmlns:table="${TABLE_NS}"><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="string"><text:p>Say "hi"</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"/><table:table-cell office:value-type="boolean" office:boolean-value="true"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
    const file = await spreadsheetPackage(content);
    const json = JSON.parse(await (await convertOfficeDocument(file, 'ods', 'json')).text());
    expect(json.sheets[0]).toEqual({
      name: 'Data',
      rows: [
        ['Say "hi"', 'Say "hi"', 42, true],
        ['Say "hi"', 'Say "hi"', 42, true],
      ],
    });
    const csv = await convertOfficeDocument(file, 'ods', 'csv');
    expect(await csv.text()).toBe('"Say ""hi""","Say ""hi""","42","true"\r\n"Say ""hi""","Say ""hi""","42","true"');
  });

  it('enforces spreadsheet row and cell limits across sheets', async () => {
    const rowLimitContent = `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:table="${TABLE_NS}"><office:body><office:spreadsheet><table:table table:name="One"><table:table-row table:number-rows-repeated="6000"/></table:table><table:table table:name="Two"><table:table-row table:number-rows-repeated="5000"/></table:table></office:spreadsheet></office:body></office:document-content>`;
    await expect(convertOfficeDocument(await spreadsheetPackage(rowLimitContent), 'ods', 'json')).rejects.toThrow(
      /10,000 row extraction limit/,
    );

    const cellLimitContent = `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:table="${TABLE_NS}"><office:body><office:spreadsheet><table:table table:name="One"><table:table-row table:number-rows-repeated="51"><table:table-cell table:number-columns-repeated="1000"/></table:table-row></table:table><table:table table:name="Two"><table:table-row table:number-rows-repeated="51"><table:table-cell table:number-columns-repeated="1000"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
    await expect(convertOfficeDocument(await spreadsheetPackage(cellLimitContent), 'ods', 'json')).rejects.toThrow(
      /100,000 cell extraction limit/,
    );
  });

  it('rejects malformed XML, encrypted packages, and declared expansion beyond the package cap', async () => {
    const malformed = asFile('<office:document-content><office:body>', 'bad.fodt');
    await expect(convertOfficeDocument(malformed, 'fodt', 'txt')).rejects.toThrow(/Malformed XML/);

    const normal = await odfPackage(
      `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:text="${TEXT_NS}"><office:body><office:text><text:p>Text</text:p></office:text></office:body></office:document-content>`,
    );
    const encryptedZip = new Uint8Array(await normal.arrayBuffer());
    const encrypted = alterCentralEntry(encryptedZip, (view, offset) => {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
    });
    await expect(convertOfficeDocument(asFile(encrypted, 'encrypted.odt'), 'odt', 'txt')).rejects.toThrow(/Encrypted office packages/);

    const expanded = alterCentralEntry(encryptedZip, (view, offset) => {
      view.setUint32(offset + 24, 32 * 1024 * 1024 + 1, true);
    });
    await expect(convertOfficeDocument(asFile(expanded, 'expanded.odt'), 'odt', 'txt')).rejects.toThrow(/32 MB of uncompressed data/);
  });

  it('escapes extracted document text before writing HTML', async () => {
    const file = await odfPackage(
      `<office:document-content xmlns:office="${OFFICE_NS}" xmlns:text="${TEXT_NS}"><office:body><office:text><text:p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</text:p></office:text></office:body></office:document-content>`,
    );
    const html = await (await convertOfficeDocument(file, 'odt', 'html')).text();
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] || '';
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(body).not.toContain('Exports document content without preserving its original layout');
  });
});
