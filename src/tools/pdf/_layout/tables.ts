import { joinRuns, median, type Line, type TextRun } from './extract';

export interface TableCell {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
}

export interface Table {
  /** Horizontal extent of each column in points. */
  columns: { x0: number; x1: number }[];
  rows: TableCell[][];
  x0: number;
  x1: number;
  y: number;
}

export type Block = { kind: 'table'; table: Table; y: number } | { kind: 'line'; line: Line; y: number };

export interface RawCell {
  runs: TextRun[];
  x0: number;
  x1: number;
}

const CELL_GAP = 0.45;
const MAX_ROW_GAP = 3.2;
const CONTINUATION_GAP = 1.4;

/** Splits a line into cells wherever the horizontal gap is wider than a word space. */
export function splitCells(line: Line): RawCell[] {
  const cells: RawCell[] = [];
  let current: TextRun[] = [];
  let prev: TextRun | undefined;
  const flush = () => {
    if (current.length === 0) return;
    cells.push({
      runs: current,
      x0: current[0].x,
      x1: Math.max(...current.map((r) => r.x + r.width)),
    });
    current = [];
  };
  for (const run of line.runs) {
    if (prev && run.x - (prev.x + prev.width) > line.size * CELL_GAP) flush();
    current.push(run);
    prev = run;
  }
  flush();
  return cells;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function mergeIntervals(cells: RawCell[]): { x0: number; x1: number }[] {
  const sorted = [...cells].sort((a, b) => a.x0 - b.x0);
  const columns: { x0: number; x1: number }[] = [];
  for (const cell of sorted) {
    const last = columns[columns.length - 1];
    if (last && cell.x0 <= last.x1) last.x1 = Math.max(last.x1, cell.x1);
    else columns.push({ x0: cell.x0, x1: cell.x1 });
  }
  return columns;
}

function columnOf(cell: RawCell, columns: { x0: number; x1: number }[]): number {
  let best = -1;
  let bestOverlap = 0;
  for (let i = 0; i < columns.length; i++) {
    const o = overlap(cell.x0, cell.x1, columns[i].x0, columns[i].x1);
    if (o > bestOverlap) {
      best = i;
      bestOverlap = o;
    }
  }
  if (best >= 0) return best;

  const center = (cell.x0 + cell.x1) / 2;
  let nearest = 0;
  let nearestDistance = Infinity;
  columns.forEach((c, i) => {
    const distance = Math.abs((c.x0 + c.x1) / 2 - center);
    if (distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function joinText(previous: string, next: string): string {
  if (!previous) return next;
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

interface Candidate {
  line: Line;
  cells: RawCell[];
}

/** Builds a table from a group of consecutive lines, or returns the count of lines that were consumed (0 = no table). */
function buildTable(group: Candidate[]): { table: Table; used: number } | null {
  const tabular = (c: Candidate) => c.cells.length >= 2;
  const maxCells = Math.max(...group.map((c) => c.cells.length));
  const modal = group.filter((c) => c.cells.length === maxCells);
  if (maxCells < 2 || group.filter(tabular).length < 2) return null;

  const columns = mergeIntervals(modal.flatMap((c) => c.cells));
  if (columns.length < 2) return null;

  // Trailing single-cell lines that span several columns are text after the table, not cell continuations.
  let used = group.length;
  while (used > 0 && !tabular(group[used - 1])) {
    const last = group[used - 1];
    const spans = last.cells.some((cell) => columns.filter((c) => overlap(cell.x0, cell.x1, c.x0, c.x1) > 0).length > 1);
    if (spans || last.line.size < group[0].line.size - 0.5 || last.line.size > group[0].line.size + 0.5) used--;
    else break;
  }
  const rowsIn = group.slice(0, used);
  if (rowsIn.filter(tabular).length < 2) return null;

  const fullGaps: number[] = [];
  let prevFull: Candidate | undefined;
  for (const c of rowsIn) {
    if (c.cells.length === maxCells) {
      if (prevFull) fullGaps.push(c.line.y - prevFull.line.y);
      prevFull = c;
    }
  }
  const fullGap = fullGaps.length > 0 ? median(fullGaps) : Infinity;

  const rows: { cells: TableCell[]; runs: TextRun[][] }[] = [];
  rowsIn.forEach((c, index) => {
    const gap = index > 0 ? c.line.y - rowsIn[index - 1].line.y : Infinity;
    const limit = Math.min(c.line.size * CONTINUATION_GAP, fullGap * 0.8);
    const isContinuation = index > 0 && rows.length > 0 && c.cells.length < maxCells && gap <= limit;

    const target = isContinuation
      ? rows[rows.length - 1]
      : {
          cells: columns.map(() => ({ text: '', bold: false, italic: false, size: c.line.size })),
          runs: columns.map(() => [] as TextRun[]),
        };

    for (const cell of c.cells) {
      const col = columnOf(cell, columns);
      target.runs[col].push(...cell.runs);
      const text = joinRuns(cell.runs);
      target.cells[col].text = joinText(target.cells[col].text, text);
      target.cells[col].size = c.line.size;
    }
    if (!isContinuation) rows.push(target);
  });

  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      const runs = row.runs[i];
      cell.bold = runs.length > 0 && runs.every((r) => r.bold);
      cell.italic = runs.length > 0 && runs.every((r) => r.italic);
    });
  }

  const nonEmpty = rows.filter((r) => r.cells.some((cell) => cell.text.trim() !== ''));
  if (nonEmpty.length < 2) return null;

  const x0 = columns[0].x0;
  const x1 = columns[columns.length - 1].x1;
  return {
    table: { columns, rows: nonEmpty.map((r) => r.cells), x0, x1, y: group[0].line.y },
    used,
  };
}

/** Splits a page into tables and plain lines, in top-to-bottom order. */
export function layoutBlocks(lines: Line[]): Block[] {
  const candidates: Candidate[] = lines.map((line) => ({ line, cells: splitCells(line) }));
  const blocks: Block[] = [];

  let i = 0;
  while (i < candidates.length) {
    if (candidates[i].cells.length < 2) {
      blocks.push({ kind: 'line', line: candidates[i].line, y: candidates[i].line.y });
      i++;
      continue;
    }

    const group: Candidate[] = [candidates[i]];
    let j = i + 1;
    while (j < candidates.length) {
      const next = candidates[j];
      const prev = group[group.length - 1];
      const gap = next.line.y - prev.line.y;
      const ok =
        next.cells.length >= 2
          ? gap <= prev.line.size * MAX_ROW_GAP
          : gap <= prev.line.size * CONTINUATION_GAP && Math.abs(next.line.size - prev.line.size) <= 0.5;
      if (!ok) break;
      group.push(next);
      j++;
    }

    const built = buildTable(group);
    if (built) {
      blocks.push({ kind: 'table', table: built.table, y: built.table.y });
      i += built.used;
    } else {
      blocks.push({ kind: 'line', line: candidates[i].line, y: candidates[i].line.y });
      i++;
    }
  }

  return blocks;
}

export interface ParsedNumber {
  value: number;
  /** Excel number format that keeps the thousands separator, decimals and percent sign of the source text. */
  format: string;
}

/** Parses "1,234.50", "(12)", "-3.5%", "1.234,56" and plain integers. Returns null for anything else. */
export function parseNumber(raw: string): ParsedNumber | null {
  let text = raw.trim();
  if (text === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const percent = text.endsWith('%');
  if (percent) text = text.slice(0, -1).trim();

  const amount = /^(?:([-−–+])\s*([$€£¥])?|([$€£¥])\s*([-−–+])?)?\s*([\d.,]+)\s*([$€£¥])?$/.exec(text);
  if (!amount) return null;
  const [, leadingSign, currencyAfterSign, leadingCurrency, signAfterCurrency, digits, trailingCurrency] = amount;
  const sign = leadingSign ?? signAfterCurrency;
  if ((negative && sign) || (trailingCurrency && (currencyAfterSign || leadingCurrency))) return null;
  negative ||= sign !== undefined && sign !== '+';
  text = digits;

  let normalized: string;
  let thousands = false;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    normalized = text.replace(/,/g, '');
    thousands = true;
  } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    normalized = text.replace(/\./g, '').replace(',', '.');
    thousands = true;
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    normalized = text;
  } else if (/^\.\d+$/.test(text)) {
    normalized = `0${text}`;
  } else {
    return null;
  }

  // Leading zeros ("007") and very long digit strings are identifiers, not quantities.
  if (/^0\d/.test(normalized) || normalized.replace('.', '').length > 15) return null;

  let value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;

  const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
  if (percent) value /= 100;

  const base = (thousands ? '#,##0' : '0') + (decimals > 0 ? `.${'0'.repeat(decimals)}` : '');
  return { value, format: percent ? `${base}%` : base };
}
