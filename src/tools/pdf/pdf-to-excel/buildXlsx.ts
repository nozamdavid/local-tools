import type { PDFDocumentProxy } from 'pdfjs-dist';
import { groupLines, readPageText } from '../_layout/extract';
import { layoutBlocks, parseNumber, type Block } from '../_layout/tables';

export interface PageBlocks {
  page: number;
  blocks: Block[];
}

export type SheetMode = 'per-page' | 'combined';

/** One rectangular range of cells: a detected table, or a run of text lines. */
export interface Grid {
  page: number;
  kind: 'table' | 'text';
  rows: { text: string; bold: boolean }[][];
}

export async function analyzePdf(
  doc: PDFDocumentProxy,
  onProgress?: (ratio: number) => void
): Promise<PageBlocks[]> {
  const pages: PageBlocks[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const text = await readPageText(doc, p);
    pages.push({ page: p, blocks: layoutBlocks(groupLines(text.runs)) });
    onProgress?.(p / doc.numPages);
  }
  return pages;
}

/** Turns analysed pages into grids, optionally keeping the text that sits outside tables. */
export function toGrids(pages: PageBlocks[], includeText: boolean): Grid[] {
  const grids: Grid[] = [];
  for (const { page, blocks } of pages) {
    let textRows: Grid['rows'] = [];
    const flushText = () => {
      if (textRows.length > 0) grids.push({ page, kind: 'text', rows: textRows });
      textRows = [];
    };

    for (const block of blocks) {
      if (block.kind === 'table') {
        flushText();
        grids.push({
          page,
          kind: 'table',
          rows: block.table.rows.map((row) => row.map((cell) => ({ text: cell.text, bold: cell.bold }))),
        });
      } else if (includeText) {
        textRows.push([{ text: block.line.text, bold: block.line.runs.every((r) => r.bold) }]);
      }
    }
    flushText();
  }
  return grids;
}

export async function buildXlsx(grids: Grid[], mode: SheetMode): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LoConvert';

  const sheets = new Map<string, { sheet: import('exceljs').Worksheet; next: number }>();
  const sheetFor = (page: number) => {
    const name = mode === 'combined' ? 'Tables' : `Page ${page}`;
    let entry = sheets.get(name);
    if (!entry) {
      entry = { sheet: workbook.addWorksheet(name), next: 1 };
      sheets.set(name, entry);
    }
    return entry;
  };

  const widths = new Map<string, number[]>();

  for (const grid of grids) {
    const entry = sheetFor(grid.page);
    const sheetWidths = widths.get(entry.sheet.name) ?? [];
    widths.set(entry.sheet.name, sheetWidths);

    for (const row of grid.rows) {
      row.forEach((cell, c) => {
        if (cell.text === '') return;
        const target = entry.sheet.getCell(entry.next, c + 1);
        const parsed = grid.kind === 'table' ? parseNumber(cell.text) : null;
        if (parsed) {
          target.value = parsed.value;
          target.numFmt = parsed.format;
          target.alignment = { horizontal: 'right' };
        } else {
          target.value = cell.text;
        }
        if (cell.bold) target.font = { bold: true };
        if (grid.kind === 'table') {
          sheetWidths[c] = Math.max(sheetWidths[c] ?? 0, Math.min(cell.text.length, 60));
        }
      });
      entry.next++;
    }
    entry.next++;
  }

  if (sheets.size === 0) throw new Error('No tables were found in this PDF.');

  for (const [name, { sheet }] of sheets) {
    (widths.get(name) ?? []).forEach((w, i) => {
      sheet.getColumn(i + 1).width = Math.max(8, w + 2);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
