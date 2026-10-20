import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../../../lib/pdf';

export type FontFamily = 'serif' | 'sans' | 'mono';

/** A text chunk from pdf.js in viewport points (origin top-left, y grows downward, y is the baseline). */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  family: FontFamily;
}

export interface PageText {
  width: number;
  height: number;
  runs: TextRun[];
}

export interface Line {
  runs: TextRun[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  text: string;
}

export interface Span {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  family: FontFamily;
}

interface FontTraits {
  bold: boolean;
  italic: boolean;
  family: FontFamily;
}

const BOLD = /bold|black|heavy|semibold|demi/i;
const ITALIC = /italic|oblique/i;
const MONO = /mono|courier|consolas|menlo|typewriter/i;
const SERIF = /times|serif|georgia|garamond|cambria|minion|palatino|book/i;

function traitsFor(name: string, cssFamily: string): FontTraits {
  const family: FontFamily = MONO.test(name) || MONO.test(cssFamily)
    ? 'mono'
    : (SERIF.test(name) && !/sans/i.test(name)) || (/serif/i.test(cssFamily) && !/sans/i.test(cssFamily))
      ? 'serif'
      : 'sans';
  return { bold: BOLD.test(name), italic: ITALIC.test(name), family };
}

interface ObjectStore {
  has(id: string): boolean;
  get(id: string): unknown;
}

function realFontName(page: PDFPageProxy, fontName: string): string {
  const store = page.commonObjs as unknown as ObjectStore;
  if (!store.has(fontName)) return '';
  const font = store.get(fontName) as { name?: string } | null;
  return font?.name ?? '';
}

/** Reads the text of one page, with positions in viewport points and bold/italic hints. */
export async function readPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const [va, vb, vc, vd, ve, vf] = viewport.transform as number[];

  const fontNames = new Set<string>();
  for (const item of content.items) if ('str' in item && item.str.trim() !== '') fontNames.add(item.fontName);

  const store = page.commonObjs as unknown as ObjectStore;
  if ([...fontNames].some((name) => !store.has(name))) {
    try {
      await page.getOperatorList();
    } catch {
      // font names stay unknown; text still converts without bold/italic hints
    }
  }

  const traits = new Map<string, FontTraits>();
  for (const name of fontNames) {
    traits.set(name, traitsFor(realFontName(page, name), content.styles[name]?.fontFamily ?? ''));
  }

  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const [a, b, , , e, f] = item.transform as number[];
    const x = va * e + vc * f + ve;
    const y = vb * e + vd * f + vf;
    const size = Math.hypot(va * a + vc * b, vb * a + vd * b) || Math.hypot(a, b) || item.height;
    const t = traits.get(item.fontName) ?? { bold: false, italic: false, family: 'sans' as FontFamily };
    runs.push({ text: item.str, x, y, width: item.width, size, ...t });
  }

  const result = { width: viewport.width, height: viewport.height, runs };
  page.cleanup();
  return result;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Joins runs of one line, inserting a space where the horizontal gap looks like a word break. */
export function joinRuns(runs: TextRun[]): string {
  let out = '';
  let prev: TextRun | undefined;
  for (const run of runs) {
    if (prev) {
      const gap = run.x - (prev.x + prev.width);
      if (gap > run.size * 0.15 && !prev.text.endsWith(' ') && !run.text.startsWith(' ')) out += ' ';
    }
    out += run.text;
    prev = run;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** Groups runs into lines by baseline, top to bottom, left to right. */
export function groupLines(runs: TextRun[]): Line[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextRun[][] = [];

  for (const run of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= Math.max(run.size, row[0].size) * 0.4) row.push(run);
    else rows.push([run]);
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const weights = new Map<number, number>();
    for (const run of row) {
      const key = Math.round(run.size * 2) / 2;
      weights.set(key, (weights.get(key) ?? 0) + run.text.length);
    }
    const size = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const x1 = Math.max(...row.map((r) => r.x + r.width));
    return { runs: row, x0: row[0].x, x1, y: row[0].y, size, text: joinRuns(row) };
  });
}

/** Style-uniform pieces of a line, for formatted output. */
export function lineSpans(runs: TextRun[]): Span[] {
  const spans: Span[] = [];
  let prev: TextRun | undefined;
  for (const run of runs) {
    let text = run.text;
    if (prev) {
      const gap = run.x - (prev.x + prev.width);
      if (gap > run.size * 0.15 && !prev.text.endsWith(' ') && !text.startsWith(' ')) text = ` ${text}`;
    }
    const last = spans[spans.length - 1];
    const size = Math.round(run.size * 2) / 2;
    if (last && last.bold === run.bold && last.italic === run.italic && last.family === run.family && last.size === size) {
      last.text += text;
    } else {
      spans.push({ text, size, bold: run.bold, italic: run.italic, family: run.family });
    }
    prev = run;
  }
  return spans;
}

/** Median glyph size weighted by character count: the body text size. */
export function bodySize(pages: PageText[]): number {
  const sizes: number[] = [];
  for (const page of pages) {
    for (const run of page.runs) {
      for (let i = 0; i < run.text.trim().length; i++) sizes.push(Math.round(run.size * 2) / 2);
    }
  }
  return median(sizes);
}

/**
 * Opens a second pdf.js document that exposes real font names (needed for bold/italic hints).
 * Falls back to the given document when the file cannot be reopened, such as for encrypted PDFs.
 */
export async function openWithFontInfo(
  file: File,
  fallback: PDFDocumentProxy
): Promise<{ doc: PDFDocumentProxy; close: () => void }> {
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data, fontExtraProperties: true });
    const doc = await task.promise;
    return { doc, close: () => void task.destroy() };
  } catch {
    return { doc: fallback, close: () => {} };
  }
}
