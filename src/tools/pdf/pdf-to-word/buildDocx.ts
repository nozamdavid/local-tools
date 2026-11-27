import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Paragraph as DocxParagraph, Table as DocxTable } from 'docx';
import { renderPdfPageToBlob } from '../../image/_pdf/pdfRenderer';
import {
  bodySize,
  groupLines,
  lineSpans,
  openWithFontInfo,
  readPageText,
  type FontFamily,
  type Line,
  type Span,
  type PageText,
} from '../_layout/extract';
import { layoutBlocks, parseNumber, type Table } from '../_layout/tables';

type Docx = typeof import('docx');
type Child = DocxParagraph | DocxTable;

export interface DocxOptions {
  /** Embed every page as an image instead of rebuilding the text. */
  exactLayout: boolean;
  onProgress?: (ratio: number) => void;
}

const PAGE_IMAGE_DPI = 150;
const FONTS: Record<FontFamily, string> = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };
const BULLET = /^([•●▪■◦‣∙·–—*-])\s+/;
const NUMBERED = /^\d{1,3}[.)]\s+/;
const HEADING_RATIO = 1.15;
const MAX_HEADING_LEVEL = 3;

const twips = (points: number) => Math.round(points * 20);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface Para {
  kind: 'heading' | 'list' | 'body';
  level: number;
  lines: Line[];
  x0: number;
  x1: number;
  y: number;
  size: number;
}

function headingRanks(pages: PageText[], body: number): number[] {
  const sizes: number[] = [];
  for (const page of pages) {
    for (const line of groupLines(page.runs)) {
      if (isHeading(line, body)) sizes.push(line.size);
    }
  }
  const ranks: number[] = [];
  for (const size of sizes.sort((a, b) => b - a)) {
    const last = ranks[ranks.length - 1];
    if (last === undefined || size < last * 0.94) ranks.push(size);
  }
  return ranks;
}

function isHeading(line: Line, body: number): boolean {
  return line.size / body >= HEADING_RATIO && line.text.length <= 140 && !BULLET.test(line.text);
}

function headingLevel(line: Line, ranks: number[]): number {
  const index = ranks.findIndex((rank) => line.size >= rank * 0.94);
  return Math.min(index + 1, MAX_HEADING_LEVEL);
}

function toParagraphs(lines: Line[], body: number, ranks: number[]): Para[] {
  const paras: Para[] = [];

  for (const line of lines) {
    const last = paras[paras.length - 1];
    const gap = last ? line.y - last.y : Infinity;

    if (isHeading(line, body)) {
      const level = headingLevel(line, ranks);
      if (last?.kind === 'heading' && last.level === level && gap <= line.size * 1.9) {
        last.lines.push(line);
        last.y = line.y;
        last.x1 = Math.max(last.x1, line.x1);
      } else {
        paras.push({ kind: 'heading', level, lines: [line], x0: line.x0, x1: line.x1, y: line.y, size: line.size });
      }
      continue;
    }

    if (BULLET.test(line.text) || NUMBERED.test(line.text)) {
      paras.push({ kind: 'list', level: 0, lines: [line], x0: line.x0, x1: line.x1, y: line.y, size: line.size });
      continue;
    }

    if (last && (last.kind === 'body' || last.kind === 'list')) {
      const close = gap <= line.size * 1.75 && gap > 0;
      const sameSize = Math.abs(last.size - line.size) < 1;
      const aligned =
        last.kind === 'list'
          ? line.x0 > last.x0 + line.size * 0.3
          : Math.abs(line.x0 - last.x0) < line.size * 1.2 || (line.x0 < last.x0 && last.x0 - line.x0 < line.size * 4);
      if (close && sameSize && aligned) {
        last.lines.push(line);
        last.y = line.y;
        last.x0 = Math.min(last.x0, line.x0);
        last.x1 = Math.max(last.x1, line.x1);
        continue;
      }
    }

    paras.push({ kind: 'body', level: 0, lines: [line], x0: line.x0, x1: line.x1, y: line.y, size: line.size });
  }

  return paras;
}

function buildParagraph(docx: Docx, para: Para, margins: { left: number; right: number }, pageWidth: number): DocxParagraph {
  const spans: Span[] = [];
  para.lines.forEach((line, index) => {
    const lineSpansOut = lineSpans(line.runs);
    const previous = para.lines[index - 1];
    if (previous && lineSpansOut.length > 0) {
      if (/[A-Za-z]-$/.test(previous.text) && /^[a-z]/.test(line.text)) {
        // join a hyphenated word that wrapped onto the next line
        const tail = spans[spans.length - 1];
        if (tail) tail.text = tail.text.replace(/-$/, '');
      } else {
        lineSpansOut[0].text = ` ${lineSpansOut[0].text.trimStart()}`;
      }
    }
    spans.push(...lineSpansOut);
  });

  const heading = para.kind === 'heading';
  const children = spans.map(
    (span) =>
      new docx.TextRun({
        text: span.text,
        bold: span.bold || undefined,
        italics: span.italic || undefined,
        size: Math.round(span.size * 2),
        font: FONTS[span.family],
        color: heading ? '000000' : undefined,
      }),
  );

  const first = para.lines[0];
  const center = (para.x0 + para.x1) / 2;
  const contentWidth = pageWidth - margins.left - margins.right;
  const centered =
    para.kind !== 'list' &&
    Math.abs(center - pageWidth / 2) < pageWidth * 0.03 &&
    para.x0 - margins.left > first.size * 2 &&
    para.x1 < pageWidth - margins.right - first.size * 2 &&
    para.x1 - para.x0 < contentWidth * 0.9;

  const indent = !centered && para.x0 - margins.left > first.size * 1.5 ? para.x0 - margins.left : 0;

  const headingLevels = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2, docx.HeadingLevel.HEADING_3];

  return new docx.Paragraph({
    children,
    heading: para.kind === 'heading' ? headingLevels[para.level - 1] : undefined,
    alignment: centered ? docx.AlignmentType.CENTER : undefined,
    indent: indent > 0 ? { left: twips(indent) } : undefined,
    spacing: { before: para.kind === 'heading' ? 160 : 0, after: para.kind === 'heading' ? 80 : 120 },
  });
}

function buildTable(docx: Docx, table: Table, maxWidth: number): DocxTable {
  const n = table.columns.length;
  // Word adds about 11pt of cell padding, so a column needs its text width plus that to avoid wrapping
  const widths = table.columns.map((col, i) => {
    const content = col.x1 - col.x0 + 18;
    return i < n - 1 ? Math.max(content, table.columns[i + 1].x0 - col.x0) : content;
  });
  const total = widths.reduce((sum, w) => sum + w, 0);
  const scale = total > maxWidth ? maxWidth / total : 1;
  const columnWidths = widths.map((w) => twips(w * scale));

  return new docx.Table({
    width: { size: columnWidths.reduce((sum, w) => sum + w, 0), type: docx.WidthType.DXA },
    columnWidths,
    rows: table.rows.map(
      (row) =>
        new docx.TableRow({
          children: row.map(
            (cell, i) =>
              new docx.TableCell({
                width: { size: columnWidths[i], type: docx.WidthType.DXA },
                children: [
                  new docx.Paragraph({
                    alignment: parseNumber(cell.text) ? docx.AlignmentType.RIGHT : undefined,
                    children: [
                      new docx.TextRun({
                        text: cell.text,
                        bold: cell.bold || undefined,
                        italics: cell.italic || undefined,
                        size: Math.round(cell.size * 2),
                        font: FONTS.sans,
                      }),
                    ],
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

async function pageImageRun(docx: Docx, doc: PDFDocumentProxy, pageNumber: number, widthPt: number, heightPt: number) {
  const blob = await renderPdfPageToBlob(doc, pageNumber, PAGE_IMAGE_DPI / 72, 'image/jpeg', 0.85);
  const data = new Uint8Array(await blob.arrayBuffer());
  // docx sizes images in CSS pixels (96 per inch); stay a hair under the page so no blank page follows
  const px = 96 / 72;
  return new docx.ImageRun({
    type: 'jpg',
    data,
    transformation: { width: (widthPt - 1) * px, height: (heightPt - 3) * px },
  });
}

/** Rebuilds a PDF as an editable DOCX (paragraphs, headings, tables) or as one image per page. */
export async function buildDocx(source: PDFDocumentProxy, file: File, options: DocxOptions): Promise<Blob> {
  const fonts = options.exactLayout ? { doc: source, close: () => {} } : await openWithFontInfo(file, source);
  try {
    return await convert(source, fonts.doc, options);
  } finally {
    fonts.close();
  }
}

async function convert(doc: PDFDocumentProxy, textDoc: PDFDocumentProxy, options: DocxOptions): Promise<Blob> {
  const docx = await import('docx');
  const total = doc.numPages;

  const pages: PageText[] = [];
  for (let p = 1; p <= total; p++) {
    pages.push(await readPageText(textDoc, p));
    if (!options.exactLayout) options.onProgress?.(p / (total * 2));
  }

  const hasText = pages.some((page) => page.runs.length > 0);
  if (!options.exactLayout && !hasText) {
    throw new Error('No text found in this PDF. It may be a scan. Turn on "Keep exact layout" or run OCR PDF first.');
  }

  const body = bodySize(pages);
  const ranks = headingRanks(pages, body);
  const sections = [];

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const pageNumber = index + 1;
    const size = { width: twips(page.width), height: twips(page.height) };
    const progress = options.exactLayout ? pageNumber / total : (total + pageNumber) / (total * 2);

    if (options.exactLayout || page.runs.length === 0) {
      const run = await pageImageRun(docx, doc, pageNumber, page.width, page.height);
      sections.push({
        properties: { page: { size, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
        children: [new docx.Paragraph({ children: [run], spacing: { before: 0, after: 0, line: 240 } })],
      });
      options.onProgress?.(progress);
      continue;
    }

    const lines = groupLines(page.runs);
    const margins = {
      left: clamp(Math.min(...lines.map((l) => l.x0)), 24, 144),
      right: clamp(page.width - Math.max(...lines.map((l) => l.x1)), 24, 144),
      top: clamp(Math.min(...lines.map((l) => l.y - l.size)), 36, 108),
      bottom: clamp(page.height - Math.max(...lines.map((l) => l.y)), 36, 108),
    };
    const maxTableWidth = page.width - margins.left - margins.right;

    const children: Child[] = [];
    let pending: Line[] = [];
    const flush = () => {
      for (const para of toParagraphs(pending, body, ranks)) {
        children.push(buildParagraph(docx, para, margins, page.width));
      }
      pending = [];
    };

    for (const block of layoutBlocks(lines)) {
      if (block.kind === 'line') {
        pending.push(block.line);
        continue;
      }
      flush();
      children.push(buildTable(docx, block.table, maxTableWidth));
      children.push(new docx.Paragraph({ spacing: { before: 0, after: 120 } }));
    }
    flush();
    if (children.length === 0) children.push(new docx.Paragraph({}));

    sections.push({
      properties: {
        page: {
          size,
          margin: {
            top: twips(margins.top),
            right: twips(margins.right),
            bottom: twips(margins.bottom),
            left: twips(margins.left),
          },
        },
      },
      children,
    });
    options.onProgress?.(progress);
  }

  const document = new docx.Document({
    creator: '',
    sections,
  });
  return docx.Packer.toBlob(document);
}
