import type { PDFDocumentProxy } from 'pdfjs-dist';
import { groupLines, lineSpans, openWithFontInfo, readPageText, type FontFamily, type Line } from '../_layout/extract';
import { splitCells } from '../_layout/tables';

export interface PptxOptions {
  dpi: number;
  /** Add the text of every line as an editable text box and clear it from the page image. */
  textBoxes: boolean;
  onProgress?: (ratio: number) => void;
}

const FONTS: Record<FontFamily, string> = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };

interface Sample {
  background: string;
  ink: string;
}

const hex = (r: number, g: number, b: number) =>
  [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

/** Reads the surrounding background and the darkest ink colour of a line's box. */
function sampleLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): Sample {
  const { width, height } = ctx.canvas;
  const px = (sx: number, sy: number) =>
    ctx.getImageData(Math.max(0, Math.min(width - 1, Math.round(sx))), Math.max(0, Math.min(height - 1, Math.round(sy))), 1, 1).data;

  const left = px(x - 2, y + h / 2);
  const right = px(x + w + 2, y + h / 2);
  const background = hex((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2);

  const bx = Math.max(0, Math.floor(x));
  const by = Math.max(0, Math.floor(y));
  const bw = Math.max(1, Math.min(width - bx, Math.ceil(w)));
  const bh = Math.max(1, Math.min(height - by, Math.ceil(h)));
  const data = ctx.getImageData(bx, by, bw, bh).data;

  let darkest = 766;
  let ink = '000000';
  for (let i = 0; i < data.length; i += 4) {
    const sum = data[i] + data[i + 1] + data[i + 2];
    if (sum < darkest) {
      darkest = sum;
      ink = hex(data[i], data[i + 1], data[i + 2]);
    }
  }
  return { background, ink };
}

/** Renders a page, clearing the given lines from the image so their text boxes do not draw twice. */
async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  lines: Line[],
): Promise<{ data: string; inks: string[] }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: lines.length > 0 });
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const boxes = lines.map((line) => ({
    x: (line.x0 - 1) * scale,
    y: (line.y - line.size * 0.9) * scale,
    w: (line.x1 - line.x0 + 2) * scale,
    h: line.size * 1.2 * scale,
  }));
  const samples = boxes.map((b) => sampleLine(ctx, b.x, b.y, b.w, b.h));
  boxes.forEach((b, i) => {
    ctx.fillStyle = `#${samples[i].background}`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });

  const data = canvas.toDataURL('image/jpeg', 0.88);
  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();
  return { data, inks: samples.map((s) => s.ink) };
}

/** Builds a PPTX with one slide per PDF page: the page image as background, plus optional text boxes. */
export async function buildPptx(doc: PDFDocumentProxy, file: File, options: PptxOptions): Promise<Blob> {
  const fonts = options.textBoxes ? await openWithFontInfo(file, doc) : { doc, close: () => {} };
  try {
    return await convert(doc, fonts.doc, options);
  } finally {
    fonts.close();
  }
}

async function convert(doc: PDFDocumentProxy, textDoc: PDFDocumentProxy, options: PptxOptions): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  const scale = options.dpi / 72;
  const total = doc.numPages;

  const first = await doc.getPage(1);
  const firstView = first.getViewport({ scale: 1 });
  first.cleanup();
  const slideW = firstView.width / 72;
  const slideH = firstView.height / 72;
  pptx.defineLayout({ name: 'PDF_PAGE', width: slideW, height: slideH });
  pptx.layout = 'PDF_PAGE';

  for (let p = 1; p <= total; p++) {
    const text = await readPageText(textDoc, p);
    const lines = options.textBoxes ? groupLines(text.runs) : [];
    const { data, inks } = await renderPage(doc, p, scale, lines);

    // fit pages whose size differs from the first page inside the slide
    const fit = Math.min(slideW / (text.width / 72), slideH / (text.height / 72));
    const w = (text.width / 72) * fit;
    const h = (text.height / 72) * fit;
    const ox = (slideW - w) / 2;
    const oy = (slideH - h) / 2;
    const k = fit / 72;

    const slide = pptx.addSlide();
    slide.addImage({ data: data.replace(/^data:/, ''), x: ox, y: oy, w, h });

    lines.forEach((line, i) => {
      // one box per cell-like segment keeps table columns where they were
      for (const segment of splitCells(line)) {
        const spans = lineSpans(segment.runs);
        if (spans.length === 0) continue;
        slide.addText(
          spans.map((span) => ({
            text: span.text,
            options: {
              fontFace: FONTS[span.family],
              fontSize: Math.max(1, span.size * fit),
              bold: span.bold,
              italic: span.italic,
              color: inks[i],
            },
          })),
          {
            x: ox + segment.x0 * k,
            y: oy + (line.y - line.size * 0.9) * k,
            w: (segment.x1 - segment.x0) * k + line.size * k * 2,
            h: line.size * 1.2 * k,
            margin: 0,
            valign: 'top',
            wrap: false,
            fit: 'none',
          },
        );
      }
    });

    options.onProgress?.(p / total);
  }

  const out = await pptx.write({ outputType: 'blob' });
  return out as Blob;
}
