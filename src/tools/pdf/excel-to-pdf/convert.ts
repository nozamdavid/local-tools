import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import {
  addElementPages,
  createStage,
  pageGeometry,
  type PageSetup,
} from '../_render/render';

export const LEGACY_XLS_MESSAGE =
  'Legacy .xls files are not supported. Open the file in Excel or LibreOffice, save it as .xlsx, and try again.';

export async function checkXlsx(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isOle || /\.xls$/i.test(file.name)) return LEGACY_XLS_MESSAGE;

  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) return 'This file is not a valid XLSX spreadsheet.';

  return null;
}

function colLetterToNumber(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col;
}

function parseCellCoord(coord: string): { col: number; row: number } | null {
  const match = coord.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    col: colLetterToNumber(match[1]),
    row: parseInt(match[2], 10),
  };
}

function parseArgb(color?: Partial<ExcelJS.Color>): string | undefined {
  if (!color?.argb) return undefined;
  const hex = color.argb;
  if (hex.length === 8) {
    return `#${hex.slice(2)}`;
  }
  if (hex.length === 6) {
    return `#${hex}`;
  }
  return undefined;
}

function getCellDisplayValue(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return cell.text || String(val);
  }
  if (val instanceof Date) {
    return val.toLocaleDateString();
  }
  if (typeof val === 'object') {
    if (cell.text) {
      return cell.text;
    }
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result);
    }
    if ('formula' in val && typeof val.formula === 'string') {
      return `=${val.formula}`;
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((rt) => rt.text).join('');
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text;
    }
    if ('error' in val) {
      return String(val.error);
    }
  }
  return cell.text || '';
}

function renderSheetToElement(ws: ExcelJS.Worksheet): HTMLElement | null {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < minRow) minRow = rowNumber;
    if (rowNumber > maxRow) maxRow = rowNumber;
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber < minCol) minCol = colNumber;
      if (colNumber > maxCol) maxCol = colNumber;
    });
  });

  if (minRow === Infinity || minCol === Infinity) {
    return null;
  }

  // Pre-parse merges
  const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>();
  const slaveCells = new Set<string>();

  const merges = ws.model?.merges || [];
  for (const rangeStr of merges) {
    const parts = rangeStr.split(':');
    if (parts.length === 2) {
      const start = parseCellCoord(parts[0]);
      const end = parseCellCoord(parts[1]);
      if (start && end) {
        mergeMap.set(parts[0], {
          colSpan: end.col - start.col + 1,
          rowSpan: end.row - start.row + 1,
        });
        for (let r = start.row; r <= end.row; r++) {
          for (let c = start.col; c <= end.col; c++) {
            if (r === start.row && c === start.col) continue;
            slaveCells.add(`${c},${r}`);
          }
        }
      }
    }
  }

  const container = document.createElement('div');
  container.style.padding = '8px';
  container.style.boxSizing = 'border-box';
  container.style.background = '#ffffff';
  container.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const title = document.createElement('h3');
  title.textContent = ws.name;
  title.style.margin = '0 0 10px 0';
  title.style.fontSize = '14px';
  title.style.fontWeight = '600';
  title.style.color = '#111827';
  container.appendChild(title);

  const table = document.createElement('table');
  table.style.borderCollapse = 'collapse';
  table.style.width = '100%';
  table.style.fontSize = '11px';
  table.style.lineHeight = '1.3';
  table.style.color = '#1f2937';
  table.style.tableLayout = 'auto';

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  for (let r = minRow; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const tr = document.createElement('tr');

    let hasVisibleCellsInRow = false;
    for (let c = minCol; c <= maxCol; c++) {
      if (slaveCells.has(`${c},${r}`)) {
        continue;
      }

      hasVisibleCellsInRow = true;
      const cell = row.getCell(c);
      const isHeader = r === minRow;
      const td = document.createElement(isHeader ? 'th' : 'td');

      td.style.border = '1px solid #d0d5dd';
      td.style.padding = '4px 8px';
      td.style.verticalAlign = 'top';
      td.style.wordBreak = 'break-word';

      // Check merge
      const merge = mergeMap.get(cell.address);
      if (merge) {
        if (merge.colSpan > 1) td.colSpan = merge.colSpan;
        if (merge.rowSpan > 1) td.rowSpan = merge.rowSpan;
      }

      // Value
      td.textContent = getCellDisplayValue(cell);

      // Alignment
      if (cell.alignment?.horizontal) {
        td.style.textAlign = cell.alignment.horizontal;
      } else if (typeof cell.value === 'number') {
        td.style.textAlign = 'right';
      } else {
        td.style.textAlign = 'left';
      }

      // Font
      if (cell.font?.bold) td.style.fontWeight = '600';
      if (cell.font?.italic) td.style.fontStyle = 'italic';
      const fontColor = parseArgb(cell.font?.color);
      if (fontColor) td.style.color = fontColor;

      // Fill
      if (cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor) {
        const bg = parseArgb(cell.fill.fgColor);
        if (bg) td.style.backgroundColor = bg;
      } else if (isHeader) {
        td.style.backgroundColor = '#f9fafb';
        td.style.fontWeight = td.style.fontWeight || '600';
      }

      tr.appendChild(td);
    }

    if (hasVisibleCellsInRow) {
      tbody.appendChild(tr);
    }
  }

  container.appendChild(table);
  return container;
}

export async function excelToPdf(
  file: File,
  setup: PageSetup,
  onProgress: (ratio: number) => void
): Promise<{ blob: Blob; pages: number }> {
  const problem = await checkXlsx(file);
  if (problem) throw new Error(problem);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('Could not read the spreadsheet. The file may be corrupt.');
  }

  const sheetsWithData = workbook.worksheets.filter(
    (ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden' && ws.actualRowCount > 0
  );

  if (sheetsWithData.length === 0) {
    throw new Error('The spreadsheet contains no data to convert.');
  }

  onProgress(0.2);

  const geo = pageGeometry(
    setup.size === 'letter' ? 'letter' : 'a4',
    setup.orientation,
    setup.marginMm
  );

  const { stage, dispose } = createStage(geo.contentWpx);
  const pdf = await PDFDocument.create();
  let totalPages = 0;

  try {
    for (let s = 0; s < sheetsWithData.length; s++) {
      const ws = sheetsWithData[s];
      const sheetEl = renderSheetToElement(ws);
      if (!sheetEl) continue;

      stage.appendChild(sheetEl);

      const added = await addElementPages(pdf, sheetEl, geo, setup.format);
      totalPages += added;

      stage.removeChild(sheetEl);
      onProgress(0.2 + (0.75 * (s + 1)) / sheetsWithData.length);
    }

    if (totalPages === 0) {
      throw new Error('No pages could be rendered from this spreadsheet.');
    }

    const bytes = await pdf.save();
    onProgress(1);

    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      pages: totalPages,
    };
  } finally {
    dispose();
  }
}
