import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  ExternalHyperlink,
  Packer,
} from 'docx';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type HeadingLevelType = (typeof HeadingLevel)[keyof typeof HeadingLevel];

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

interface LinkBox {
  url: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const BULLET_REGEX = /^([•●▪■◦‣∙·–—*-])\s+(.+)$/;
const NUMBERED_REGEX = /^(\d{1,3}[.)])\s+(.+)$/;

function median(values: number[]): number {
  if (values.length === 0) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
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
    const size = Math.hypot(a, b) || item.height || 12;
    const cx = e + item.width / 2;
    const cy = f + size / 3;
    const link = links.find((l) => cx >= l.x1 && cx <= l.x2 && cy >= l.y1 && cy <= l.y2);
    runs.push({ text: item.str, x: e, y: f, width: item.width, size, url: link?.url });
  }
  return runs;
}

function groupLines(runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Run[][] = [];

  for (const run of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= Math.max(run.size, row[0].size, 10) * 0.45) {
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
    const size = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row[0].size;
    const text = row
      .map((r, i) => {
        if (i === 0) return r.text;
        const prev = row[i - 1];
        const gap = r.x - (prev.x + prev.width);
        const needsSpace =
          gap > r.size * 0.15 && !prev.text.endsWith(' ') && !r.text.startsWith(' ');
        return (needsSpace ? ' ' : '') + r.text;
      })
      .join('')
      .replace(/[ \t]+/g, ' ')
      .trim();

    return { runs: row, x: row[0].x, y: row[0].y, size, text };
  });
}

function headingSizeRanks(allLines: Line[], body: number): number[] {
  const sizes = allLines
    .filter((l) => l.size / body >= 1.15 && l.text.length <= 140 && !BULLET_REGEX.test(l.text))
    .map((l) => l.size);
  const ranks: number[] = [];
  for (const size of sizes.sort((a, b) => b - a)) {
    const last = ranks[ranks.length - 1];
    if (last === undefined || size < last * 0.94) ranks.push(size);
  }
  return ranks;
}

function getHeadingLevel(line: Line, body: number, ranks: number[]): HeadingLevelType | undefined {
  if (line.size / body < 1.15 || line.text.length > 140 || BULLET_REGEX.test(line.text)) {
    return undefined;
  }
  const index = ranks.findIndex((rank) => line.size >= rank * 0.94);
  if (index === 0) return HeadingLevel.HEADING_1;
  if (index === 1) return HeadingLevel.HEADING_2;
  if (index === 2) return HeadingLevel.HEADING_3;
  if (index >= 3) return HeadingLevel.HEADING_4;
  return undefined;
}

function runsToDocxChildren(runs: Run[]): (TextRun | ExternalHyperlink)[] {
  const children: (TextRun | ExternalHyperlink)[] = [];
  let prev: Run | undefined;

  for (const run of runs) {
    const gap = prev ? run.x - (prev.x + prev.width) : 0;
    const needsSpace =
      prev !== undefined &&
      gap > run.size * 0.15 &&
      !prev.text.endsWith(' ') &&
      !run.text.startsWith(' ');

    const displayText = (needsSpace ? ' ' : '') + run.text;
    if (run.url) {
      children.push(
        new ExternalHyperlink({
          children: [new TextRun({ text: displayText, style: 'Hyperlink' })],
          link: run.url,
        })
      );
    } else {
      children.push(new TextRun({ text: displayText }));
    }
    prev = run;
  }

  return children;
}

export async function pdfToDocx(
  doc: PDFDocumentProxy,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const numPages = doc.numPages;
  const pageRuns: Run[][] = [];
  let totalRuns = 0;

  for (let p = 1; p <= numPages; p++) {
    onProgress?.((p - 1) / (numPages * 2));
    const runs = await readPageRuns(doc, p);
    pageRuns.push(runs);
    totalRuns += runs.length;
  }

  if (totalRuns === 0) {
    throw new Error(
      'No selectable text was found in this PDF. It appears to be a scanned document or image-only PDF. To convert it to Word, first use the OCR PDF tool to extract the text.'
    );
  }

  const allLines = pageRuns.flatMap((runs) => groupLines(runs));
  const bodySize = median(allLines.map((l) => l.size));
  const ranks = headingSizeRanks(allLines, bodySize);

  const docParagraphs: Paragraph[] = [];

  for (let p = 0; p < numPages; p++) {
    onProgress?.(0.5 + p / (numPages * 2));
    const runs = pageRuns[p];
    if (runs.length === 0) continue;

    if (p > 0 && docParagraphs.length > 0) {
      docParagraphs.push(new Paragraph({ children: [new PageBreak()] }));
    }

    const lines = groupLines(runs);

    let currentParagraphRuns: Run[] = [];
    let currentHeading: HeadingLevelType | undefined;
    let isBullet = false;
    let lastY = 0;
    let lastSize = bodySize;

    const flushParagraph = () => {
      if (currentParagraphRuns.length === 0) return;
      const children = runsToDocxChildren(currentParagraphRuns);
      if (currentHeading) {
        docParagraphs.push(
          new Paragraph({
            heading: currentHeading,
            spacing: { before: 240, after: 120 },
            children,
          })
        );
      } else if (isBullet) {
        docParagraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children,
          })
        );
      } else {
        docParagraphs.push(
          new Paragraph({
            spacing: { after: 120, line: 276 },
            children,
          })
        );
      }
      currentParagraphRuns = [];
      currentHeading = undefined;
      isBullet = false;
    };

    for (const line of lines) {
      const heading = getHeadingLevel(line, bodySize, ranks);
      const bulletMatch = BULLET_REGEX.exec(line.text);
      const numberedMatch = bulletMatch ? null : NUMBERED_REGEX.exec(line.text);

      if (heading) {
        flushParagraph();
        currentHeading = heading;
        currentParagraphRuns = line.runs;
        flushParagraph();
        continue;
      }

      if (bulletMatch || numberedMatch) {
        flushParagraph();
        isBullet = true;
        currentParagraphRuns = line.runs;
        flushParagraph();
        continue;
      }

      const verticalGap = lastY - line.y;
      const isContinuation =
        currentParagraphRuns.length > 0 &&
        !currentHeading &&
        !isBullet &&
        verticalGap <= lastSize * 1.8 &&
        verticalGap >= 0 &&
        Math.abs(line.size - lastSize) <= 2;

      if (isContinuation) {
        currentParagraphRuns.push(...line.runs);
      } else {
        flushParagraph();
        currentParagraphRuns = [...line.runs];
      }

      lastY = line.y;
      lastSize = line.size;
    }

    flushParagraph();
  }

  onProgress?.(0.95);

  const document = new Document({
    sections: [
      {
        properties: {},
        children: docParagraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  onProgress?.(1);
  return blob;
}
