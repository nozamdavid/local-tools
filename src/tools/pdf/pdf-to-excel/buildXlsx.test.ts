import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { buildXlsx } from './buildXlsx';

it('preserves signed currency and identifiers in exported numeric table cells', async () => {
  const blob = await buildXlsx(
    [
      {
        page: 1,
        kind: 'table',
        rows: [['$-12.50', '−€12.50', '($12.50)', '007', '(--12.50)'].map((text) => ({ text, bold: false }))],
      },
    ],
    'per-page',
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Page 1')!;

  expect(['A1', 'B1', 'C1', 'D1', 'E1'].map((address) => sheet.getCell(address).value)).toEqual([-12.5, -12.5, -12.5, '007', '(--12.50)']);
  expect(sheet.getCell('A1').numFmt).toBe('0.00');
});
