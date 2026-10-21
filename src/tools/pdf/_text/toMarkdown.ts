import type { PDFDocumentProxy } from 'pdfjs-dist';

interface Run {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  url?: string;
}

interface Line {
  runs: Run[];
  x: number;
  y: number;
  size: number;
  text: string;
}

type Block =
  | { kind: 'heading'; level: number; text: string; y: number }
  | { kind: 'list'; marker: string; text: string; x: number; y: number; size: number }
  | { kind: 'paragraph'; text: string; x: number; y: number; size: number };

interface LinkBox {
  url: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const BULLET = /^([•●▪■◦‣∙·–—*-])\s+(.+)$/;
const NUMBERED = /^(\d{1,3}[.)])\s+(.+)$/;

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`])/g, '\\$1');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function readPageRuns(doc: PDFDocumentProxy, pageNumber: number): Promise<Run[]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const annotations = await page.getAnnotations();
  page.cleanup();

  const links: LinkBox[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || !annotation.url || !annotation.rect) continue;
    const [a, b, c, d] = annotation.rect as number[];
    links.push({
      url: annotation.url as string,
      x1: Math.min(a, c),
      y1: Math.min(b, d),
      x2: Math.max(a, c),
      y2: Math.max(b, d),
    });
  }

  const runs: Run[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const [a, b, , , e, f] = item.transform as number[];
    const size = Math.hypot(a, b) || item.height;
    const cx = e + item.width / 2;
    const cy = f + size / 3;
    const link = links.find((l) => cx >= l.x1 && cx <= l.x2 && cy >= l.y1 && cy <= l.y2);
    runs.push({ text: item.str, x: e, y: f, width: item.width, size, url: link?.url });
  }
  return runs;
}

function renderRuns(runs: Run[]): string {
  let out = '';
  let openUrl: string | undefined;
  let linkText = '';
  let prev: Run | undefined;

  const flushLink = () => {
    if (openUrl === undefined) return;
    const text = linkText.trim();
    out += text ? `[${text}](${openUrl})` : '';
    if (linkText.endsWith(' ')) out += ' ';
    openUrl = undefined;
    linkText = '';
  };

  for (const run of runs) {
    const gap = prev ? run.x - (prev.x + prev.width) : 0;
    const needsSpace = prev !== undefined && gap > run.size * 0.15 && !prev.text.endsWith(' ') && !run.text.startsWith(' ');
    const text = escapeMarkdown(run.text);

    if (run.url !== openUrl) flushLink();
    if (needsSpace) {
      if (run.url !== undefined && openUrl === run.url) linkText += ' ';
      else out += ' ';
    }

    if (run.url !== undefined) {
      openUrl = run.url;
      linkText += text;
    } else {
      out += text;
    }
    prev = run;
  }
  flushLink();
  return out.replace(/[ \t]+/g, ' ').trim();
}

function groupLines(runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Run[][] = [];

  for (const run of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= Math.max(run.size, row[0].size) * 0.4) {
      row.push(run);
    } else {
      rows.push([run]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const weights = new Map<number, number>();
    for (const run of row) {
      const key = Math.round(run.size * 2) / 2;
      weights.set(key, (weights.get(key) ?? 0) + run.text.length);
    }
    const size = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { runs: row, x: row[0].x, y: row[0].y, size, text: renderRuns(row) };
  });
}

const HEADING_RATIO = 1.15;
const MAX_HEADING_LEVEL = 4;

function isHeadingCandidate(line: Line, body: number): boolean {
  return line.size / body >= HEADING_RATIO && line.text.length <= 140 && !BULLET.test(line.text);
}

/** Ranks the distinct heading sizes in the document: the largest becomes #, the next ##, and so on. */
function headingSizeRanks(allLines: Line[], body: number): number[] {
  const sizes = allLines.filter((l) => isHeadingCandidate(l, body)).map((l) => l.size);
  const ranks: number[] = [];
  for (const size of sizes.sort((a, b) => b - a)) {
    const last = ranks[ranks.length - 1];
    if (last === undefined || size < last * 0.94) ranks.push(size);
  }
  return ranks;
}

function headingLevel(line: Line, body: number, ranks: number[]): number {
  if (!isHeadingCandidate(line, body)) return 0;
  const index = ranks.findIndex((rank) => line.size >= rank * 0.94);
  return Math.min(index + 1, MAX_HEADING_LEVEL);
}

function joinWrapped(previous: string, next: string): string {
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

function blocksFromLines(lines: Line[], body: number, ranks: number[]): Block[] {
  const blocks: Block[] = [];

  for (const line of lines) {
    const level = headingLevel(line, body, ranks);
    const bullet = BULLET.exec(line.text);
    const numbered = bullet ? null : NUMBERED.exec(line.text);
    const last = blocks[blocks.length - 1];

    if (level > 0) {
      if (last?.kind === 'heading' && last.level === level && last.y - line.y <= line.size * 1.9) {
        last.text = `${last.text} ${line.text}`;
        last.y = line.y;
      } else {
        blocks.push({ kind: 'heading', level, text: line.text, y: line.y });
      }
      continue;
    }

    if (bullet || numbered) {
      const match = (bullet ?? numbered)!;
      const marker = bullet ? '-' : match[1].replace(')', '.');
      blocks.push({
        kind: 'list',
        marker,
        text: match[2].trim(),
        x: line.x,
        y: line.y,
        size: line.size,
      });
      continue;
    }

    const gapLimit = line.size * 1.9;
    if (last && (last.kind === 'paragraph' || last.kind === 'list')) {
      const close = last.y - line.y <= gapLimit && last.y > line.y;
      const sameSize = Math.abs(last.size - line.size) < 1;
      const indented = last.kind === 'list' ? line.x > last.x + line.size * 0.3 : Math.abs(line.x - last.x) < line.size * 4;
      if (close && sameSize && indented) {
        last.text = joinWrapped(last.text, line.text);
        last.y = line.y;
        if (last.kind === 'paragraph') last.x = Math.min(last.x, line.x);
        continue;
      }
    }

    blocks.push({ kind: 'paragraph', text: line.text, x: line.x, y: line.y, size: line.size });
  }

  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  let prevList: string | null = null;

  for (const block of blocks) {
    if (block.kind === 'list') {
      const line = `${block.marker} ${block.text}`;
      const type = block.marker === '-' ? 'bullet' : 'numbered';
      if (prevList === type) parts[parts.length - 1] += `\n${line}`;
      else parts.push(line);
      prevList = type;
      continue;
    }
    prevList = null;
    parts.push(block.kind === 'heading' ? `${'#'.repeat(block.level)} ${block.text}` : block.text);
  }

  return parts.join('\n\n');
}

export interface MarkdownProgress {
  (done: number, total: number): void;
}

/** Converts a pdf.js document into Markdown. Returns an empty string when no text layer exists. */
export async function pdfToMarkdown(doc: PDFDocumentProxy, onProgress?: MarkdownProgress): Promise<string> {
  const pageRuns: Run[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    pageRuns.push(await readPageRuns(doc, p));
    onProgress?.(p, doc.numPages);
  }

  const sizes: number[] = [];
  for (const runs of pageRuns) {
    for (const run of runs) {
      for (let i = 0; i < run.text.trim().length; i++) sizes.push(Math.round(run.size * 2) / 2);
    }
  }
  if (sizes.length === 0) return '';
  const body = median(sizes);

  const pageLines = pageRuns.map(groupLines);
  const ranks = headingSizeRanks(pageLines.flat(), body);

  const pages = pageLines.map((lines) => renderBlocks(blocksFromLines(lines, body, ranks))).filter((text) => text.length > 0);

  return pages.join('\n\n') + '\n';
}
