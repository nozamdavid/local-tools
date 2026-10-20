import ExcelJS from 'exceljs';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface XlsxExportOptions {
  /** How worksheets are organized. 'per-page' creates a sheet per page; 'single' merges all pages into one sheet. */
  sheetMode?: 'per-page' | 'single';
  /** Array of 1-based page numbers to extract. Defaults to all pages. */
  pages?: number[];
}

interface RawRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RowCell {
  text: string;
  x: number;
  width: number;
  right: number;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[*?:/\\\[\]]/g, '').trim();
  return cleaned.slice(0, 31) || 'Sheet';
}

function extractRowsFromPageItems(items: RawRun[]): string[][] {
  if (items.length === 0) return [];

  // Sort descending Y (top of page to bottom), then ascending X
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rawRows: RawRun[][] = [];

  for (const item of sorted) {
    const row = rawRows[rawRows.length - 1];
    if (row && Math.abs(row[0].y - item.y) <= Math.max(row[0].height, item.height, 10) * 0.45) {
      row.push(item);
    } else {
      rawRows.push([item]);
    }
  }

  // Merge nearby runs on the same line into unified cells
  const rowCells: RowCell[][] = rawRows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: RowCell[] = [];
    let current: RowCell | null = null;

    for (const run of row) {
      if (!current) {
        current = { text: run.str, x: run.x, width: run.width, right: run.x + run.width };
      } else {
        const gap = run.x - current.right;
        const isClose = gap <= Math.max(run.height * 0.35, 5);
        if (isClose) {
          const needsSpace =
            !current.text.endsWith(' ') && !run.str.startsWith(' ') && gap > 0.5;
          current.text += (needsSpace ? ' ' : '') + run.str;
          current.right = run.x + run.width;
          current.width = current.right - current.x;
        } else {
          cells.push(current);
          current = { text: run.str, x: run.x, width: run.width, right: run.x + run.width };
        }
      }
    }
    if (current) cells.push(current);
    return cells;
  });

  // Collect candidate column dividers from horizontal gaps in rows with multiple cells
  const multiCellRows = rowCells.filter((r) => r.length > 1);
  const rowsForGutters = multiCellRows.length > 0 ? multiCellRows : rowCells;

  const splits: number[] = [];
  for (const r of rowsForGutters) {
    for (let i = 0; i < r.length - 1; i++) {
      const gapStart = r[i].right;
      const gapEnd = r[i + 1].x;
      if (gapEnd > gapStart) {
        splits.push((gapStart + gapEnd) / 2);
      }
    }
  }

  splits.sort((a, b) => a - b);
  const clusteredDividers: number[] = [];
  for (const s of splits) {
    const last = clusteredDividers[clusteredDividers.length - 1];
    if (last === undefined || s - last > 16) {
      clusteredDividers.push(s);
    }
  }

  // Filter out dividers that slice directly through cells in the multi-cell table rows
  const validDividers = clusteredDividers.filter((div) => {
    let cutsThrough = 0;
    for (const r of rowsForGutters) {
      for (const cell of r) {
        if (cell.x + 3 < div && div < cell.right - 3) {
          cutsThrough++;
        }
      }
    }
    return cutsThrough <= Math.max(0, rowsForGutters.length * 0.2);
  });

  const numCols = validDividers.length + 1;
  return rowCells.map((r) => {
    const rowValues = new Array<string>(numCols).fill('');
    for (const cell of r) {
      // For single-cell rows (like titles or paragraphs), position at the start
      const cx = r.length === 1 ? cell.x + 2 : (cell.x + cell.right) / 2;
      let colIdx = 0;
      for (let i = 0; i < validDividers.length; i++) {
        if (cx > validDividers[i]) {
          colIdx = i + 1;
        } else {
          break;
        }
      }
      if (rowValues[colIdx]) {
        rowValues[colIdx] += ' ' + cell.text.trim();
      } else {
        rowValues[colIdx] = cell.text.trim();
      }
    }
    return rowValues;
  });
}

function parseCellValue(text: string): string | number {
  const trimmed = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  return trimmed;
}

export async function pdfToXlsx(
  doc: PDFDocumentProxy,
  options?: XlsxExportOptions,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const numPages = doc.numPages;
  const sheetMode = options?.sheetMode ?? 'per-page';

  const targetPages = (options?.pages && options.pages.length > 0 ? options.pages : undefined) ??
    Array.from({ length: numPages }, (_, i) => i + 1);

  const validPages = targetPages.filter((p) => p >= 1 && p <= numPages);
  if (validPages.length === 0) {
    throw new Error('No valid pages selected for Excel export.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Loconvert';

  let totalRowsFound = 0;
  let singleWorksheet: ExcelJS.Worksheet | undefined;
  if (sheetMode === 'single') {
    singleWorksheet = workbook.addWorksheet(sanitizeSheetName('Extracted Data'));
  }

  for (let idx = 0; idx < validPages.length; idx++) {
    const pageNum = validPages[idx];
    onProgress?.(idx / validPages.length);

    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    page.cleanup();

    const rawItems: RawRun[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const [a, b, , , e, f] = item.transform as number[];
      const height = Math.hypot(a, b) || item.height || 12;
      rawItems.push({ str: item.str, x: e, y: f, width: item.width, height });
    }

    const rows = extractRowsFromPageItems(rawItems);
    totalRowsFound += rows.length;

    if (sheetMode === 'per-page') {
      const sheetName = sanitizeSheetName(
        validPages.length === 1 ? 'Sheet 1' : `Page ${pageNum}`
      );
      const ws = workbook.addWorksheet(sheetName);
      for (const row of rows) {
        ws.addRow(row.map(parseCellValue));
      }
      ws.columns.forEach((col) => {
        let maxLen = 8;
        col.eachCell?.({ includeEmpty: false }, (cell) => {
          maxLen = Math.max(maxLen, String(cell.value ?? '').length);
        });
        col.width = Math.min(Math.max(maxLen + 2, 10), 60);
      });
    } else if (singleWorksheet) {
      if (validPages.length > 1 && idx > 0) {
        singleWorksheet.addRow([`--- Page ${pageNum} ---`]);
      }
      for (const row of rows) {
        singleWorksheet.addRow(row.map(parseCellValue));
      }
    }
  }

  if (sheetMode === 'single' && singleWorksheet) {
    singleWorksheet.columns.forEach((col) => {
      let maxLen = 8;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        maxLen = Math.max(maxLen, String(cell.value ?? '').length);
      });
      col.width = Math.min(Math.max(maxLen + 2, 10), 60);
    });
  }

  if (totalRowsFound === 0) {
    throw new Error(
      'No tabular or text data was found in this PDF. It appears to be a scanned document or image-only PDF. To extract tables from scans, run it through OCR PDF first.'
    );
  }

  onProgress?.(0.95);
  const buffer = await workbook.xlsx.writeBuffer();
  onProgress?.(1);

  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
