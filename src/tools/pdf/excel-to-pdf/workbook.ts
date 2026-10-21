import type { Cell, CellValue, Worksheet } from 'exceljs';

export interface CellModel {
  text: string;
  bold: boolean;
  italic: boolean;
  color?: string;
  background?: string;
  align?: string;
  valign?: string;
  wrap: boolean;
  bordered: boolean;
  colSpan: number;
  rowSpan: number;
  fontSize?: number;
}

export interface RowModel {
  heightPx: number;
  /** null marks a position covered by a merged cell. */
  cells: (CellModel | null)[];
}

export interface SheetModel {
  name: string;
  colWidthsPx: number[];
  rows: RowModel[];
}

const MAX_CELLS = 400_000;
const DEFAULT_COL_PX = 64;
const DEFAULT_ROW_PX = 20;

function argbToCss(color?: { argb?: string }): string | undefined {
  const argb = color?.argb;
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

function decimals(numFmt: string): number {
  const match = numFmt.split(';')[0].match(/\.(0+)/);
  return match ? match[1].length : 0;
}

function formatNumber(value: number, numFmt: string): string {
  if (!numFmt || numFmt === 'General') return String(value);

  const digits = decimals(numFmt);
  if (numFmt.includes('%')) return `${(value * 100).toFixed(digits)}%`;

  if (/[0#]/.test(numFmt)) {
    const grouped = numFmt.includes(',');
    const body = value.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: grouped,
    });
    const prefix = numFmt.match(/["\\]?([$€£¥])/)?.[1] ?? '';
    return `${prefix}${body}`;
  }

  return String(value);
}

function formatDate(value: Date, numFmt: string): string {
  const hasTime = /h|s/i.test(numFmt.replace(/"[^"]*"/g, '')) && /h/i.test(numFmt);
  const hasDate = /[dy]/i.test(numFmt) || !hasTime;
  const parts: string[] = [];
  if (hasDate) parts.push(value.toLocaleDateString('en-GB', { timeZone: 'UTC' }));
  if (hasTime) parts.push(value.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }));
  return parts.join(' ');
}

function valueText(value: CellValue, numFmt: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value, numFmt);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return formatDate(value, numFmt);

  const obj = value as unknown as Record<string, unknown>;
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return (obj.richText as { text: string }[]).map((r) => r.text).join('');
  }
  if ('result' in obj) return valueText((obj.result ?? '') as CellValue, numFmt);
  if ('text' in obj && typeof obj.text === 'string') return obj.text;
  if ('error' in obj) return String(obj.error);
  return '';
}

function toCellModel(cell: Cell): CellModel {
  const fill = cell.fill;
  const bg = fill && fill.type === 'pattern' && fill.pattern === 'solid' ? argbToCss(fill.fgColor) : undefined;
  const border = cell.border;
  const bordered = !!(border && (border.top?.style || border.bottom?.style || border.left?.style || border.right?.style));

  return {
    text: valueText(cell.value, cell.numFmt),
    bold: !!cell.font?.bold,
    italic: !!cell.font?.italic,
    color: argbToCss(cell.font?.color),
    background: bg,
    align: cell.alignment?.horizontal ?? (typeof cell.value === 'number' ? 'right' : undefined),
    valign: cell.alignment?.vertical,
    wrap: !!cell.alignment?.wrapText,
    bordered,
    colSpan: 1,
    rowSpan: 1,
    fontSize: cell.font?.size,
  };
}

function parseAddress(addr: string): { col: number; row: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

function sheetToModel(ws: Worksheet): SheetModel | null {
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  if (rowCount === 0 || colCount === 0) return null;
  if (rowCount * colCount > MAX_CELLS) {
    throw new Error(`Sheet "${ws.name}" is too large to convert in the browser.`);
  }

  const hiddenCols = new Set<number>();
  const colWidthsPx: number[] = [];
  for (let c = 1; c <= colCount; c++) {
    const col = ws.getColumn(c);
    if (col.hidden) hiddenCols.add(c);
    colWidthsPx.push(col.width ? Math.round(col.width * 7 + 5) : DEFAULT_COL_PX);
  }

  const rows: RowModel[] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    if (row.hidden) continue;
    const cells: (CellModel | null)[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(toCellModel(row.getCell(c)));
    }
    rows.push({ heightPx: row.height ? Math.round(row.height * (96 / 72)) : DEFAULT_ROW_PX, cells });
  }

  // Map original row numbers to model rows (hidden rows are dropped).
  const rowIndex = new Map<number, number>();
  let k = 0;
  for (let r = 1; r <= rowCount; r++) {
    if (!ws.getRow(r).hidden) rowIndex.set(r, k++);
  }

  for (const range of ws.model.merges ?? []) {
    const [from, to] = range.split(':');
    const a = parseAddress(from);
    const b = parseAddress(to ?? from);
    const top = rowIndex.get(a.row);
    if (top === undefined) continue;

    const master = rows[top].cells[a.col - 1];
    if (!master) continue;
    master.colSpan = b.col - a.col + 1;
    master.rowSpan = Array.from({ length: b.row - a.row + 1 }, (_, i) => rowIndex.get(a.row + i)).filter((v) => v !== undefined).length;

    for (let r = a.row; r <= b.row; r++) {
      const mr = rowIndex.get(r);
      if (mr === undefined) continue;
      for (let c = a.col; c <= b.col; c++) {
        if (r === a.row && c === a.col) continue;
        rows[mr].cells[c - 1] = null;
      }
    }
  }

  // Drop hidden columns.
  if (hiddenCols.size > 0) {
    const keep = (_: unknown, i: number) => !hiddenCols.has(i + 1);
    for (const row of rows) row.cells = row.cells.filter(keep);
    const widths = colWidthsPx.filter(keep);
    colWidthsPx.length = 0;
    colWidthsPx.push(...widths);
  }

  // Trim trailing empty rows.
  while (rows.length > 0 && rows[rows.length - 1].cells.every((c) => !c || c.text === '')) rows.pop();
  if (rows.length === 0 || colWidthsPx.length === 0) return null;

  return { name: ws.name, colWidthsPx, rows };
}

export async function readWorkbook(file: File): Promise<SheetModel[]> {
  const mod = await import('exceljs');
  const Workbook = mod.Workbook ?? (mod as unknown as { default: typeof mod }).default.Workbook;

  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as an XLSX workbook. Legacy .xls files are not supported.');
  }

  const sheets: SheetModel[] = [];
  for (const ws of workbook.worksheets) {
    if (ws.state !== 'visible') continue;
    const model = sheetToModel(ws);
    if (model) sheets.push(model);
  }

  if (sheets.length === 0) throw new Error('This workbook has no visible sheets with data.');
  return sheets;
}
