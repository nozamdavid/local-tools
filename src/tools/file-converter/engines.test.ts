import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { executeConversion } from './engines';
import { loadPdfDocument, renderPdfPageToBlob } from '../image/_pdf/pdfRenderer';

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
    const file = new File(['"first,name",notes\r\n" Smith, Jr. ","line one\nline ""two"""'], '.contacts');
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
    expect(result.name).toBe('.contacts.json');
    await expect(result.blob.text()).resolves.toBe(
      JSON.stringify([{ 'first,name': ' Smith, Jr. ', notes: 'line one\nline "two"' }], null, 2),
    );
  });
});

describe('executeConversion XLSX exports', () => {
  it('preserves blank rows in the first sheet CSV export', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');
    worksheet.getCell('A1').value = 'first row';
    worksheet.getCell('A3').value = 'third row';
    worksheet.getCell('A4').value = { formula: '1/0', result: { error: '#DIV/0!' } };
    worksheet.getCell('A5').value = '';

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
    expect(result.name).toBe('rows.csv');
    await expect(result.blob.text()).resolves.toBe('first row\n\nthird row\n#DIV/0!\n""');
  });
});

it.each([false, true])('destroys the PDF document after rendering (failure: %s)', async (fail) => {
  const destroy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(loadPdfDocument).mockResolvedValue({
    numPages: 1,
    loadingTask: { destroy },
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>);
  const render = vi.mocked(renderPdfPageToBlob);
  if (fail) render.mockRejectedValueOnce(new Error('Render failed'));
  else render.mockResolvedValueOnce(new Blob(['rendered page'], { type: 'image/png' }));

  const result = executeConversion({
    file: new File([], 'sample.pdf'),
    detected: {
      id: 'pdf',
      label: 'PDF',
      family: 'document',
      mime: 'application/pdf',
      ext: 'pdf',
      extensionMismatch: false,
      actualExtension: 'pdf',
    },
    target: { id: 'png', label: 'PNG', family: 'image', ext: 'png' },
  });
  if (fail) {
    await expect(result).rejects.toThrow('Render failed');
  } else {
    const output = await result;
    if (output.type !== 'single') throw new Error('Expected a single image result.');
    expect(output.name).toBe('sample.png');
    await expect(output.blob.text()).resolves.toBe('rendered page');
  }
  expect(destroy).toHaveBeenCalledOnce();
});
