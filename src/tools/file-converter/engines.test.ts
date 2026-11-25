import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { executeConversion } from './engines';

vi.mock('../../lib/ffmpeg', () => ({ runFFmpeg: vi.fn() }));
vi.mock('../../lib/image', () => ({
  decodeImage: vi.fn(),
  loadImage: vi.fn(),
  imageToCanvas: vi.fn(),
  canvasToBlob: vi.fn(),
  encodeBmp: vi.fn(),
  encodeGif: vi.fn(),
  encodeIco: vi.fn(),
}));
vi.mock('../../lib/jxl', () => ({ encodeJxlCanvas: vi.fn() }));
vi.mock('../image/_pdf/pdfRenderer', () => ({ loadPdfDocument: vi.fn(), renderPdfPageToBlob: vi.fn() }));
vi.mock('../image/_pdf/docxRenderer', () => ({ renderDocxToImages: vi.fn() }));
vi.mock('./office', () => ({ convertOfficeDocument: vi.fn() }));

describe('executeConversion tabular exports', () => {
  it('preserves quoted delimiters, multiline fields, and significant whitespace in CSV to JSON', async () => {
    const file = new File(['"first,name",notes\r\n" Smith, Jr. ","line one\nline ""two"""'], 'contacts.csv');
    const result = await executeConversion({
      file,
      detected: {
        id: 'csv',
        label: 'CSV Document',
        family: 'text',
        mime: 'text/csv',
        ext: 'csv',
        extensionMismatch: false,
        actualExtension: 'csv',
      },
      target: { id: 'json', label: 'JSON', family: 'text', ext: 'json' },
    });

    if (result.type !== 'single') throw new Error('Expected a single JSON result.');
    expect(JSON.parse(await result.blob.text())).toEqual([{ 'first,name': ' Smith, Jr. ', notes: 'line one\nline "two"' }]);
  });
});

describe('executeConversion XLSX exports', () => {
  it('preserves blank rows in the first sheet CSV export', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');
    worksheet.getCell('A1').value = 'first row';
    worksheet.getCell('A3').value = 'third row';

    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'rows.xlsx');
    const result = await executeConversion({
      file,
      detected: {
        id: 'xlsx',
        label: 'Excel Spreadsheet (XLSX)',
        family: 'document',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
        extensionMismatch: false,
        actualExtension: 'xlsx',
      },
      target: { id: 'csv', label: 'CSV', family: 'text', ext: 'csv' },
    });

    expect(result.type).toBe('single');
    if (result.type !== 'single') throw new Error('Expected a single CSV result.');
    await expect(result.blob.text()).resolves.toBe('first row\n\nthird row');
  });
});
