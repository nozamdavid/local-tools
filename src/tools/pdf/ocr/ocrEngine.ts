import type { PDFDocument, PDFFont } from 'pdf-lib';
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Worker as TesseractWorker, Word, Line } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import coreSimd from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import corePlain from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { translate } from '../../../lib/i18n';

export interface OcrLanguage {
  value: string;
  label: string;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { value: 'eng', label: 'English' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'por', label: 'Portuguese' },
  { value: 'ita', label: 'Italian' },
  { value: 'nld', label: 'Dutch' },
];

// Language data is the only remote fetch. It is a public model file and carries no user data.
const LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/{lang}/4.0.0_best_int';

const MAX_SIDE_PX = 6000;

// Smallest module that only validates when the engine supports WebAssembly SIMD.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

const absolute = (url: string) => new URL(url, window.location.href).href;

export interface OcrWorker {
  recognizePage: (image: Blob, onProgress: (ratio: number) => void) => Promise<OcrPageResult>;
  terminate: () => Promise<void>;
}

export interface OcrPageResult {
  text: string;
  lines: Line[];
}

export async function createOcrWorker(language: string, onStatus: (status: string) => void): Promise<OcrWorker> {
  const { createWorker, OEM } = await import('tesseract.js');
  let onProgress: (ratio: number) => void = () => {};

  const core = WebAssembly.validate(SIMD_PROBE) ? coreSimd : corePlain;
  const worker: TesseractWorker = await createWorker(language, OEM.LSTM_ONLY, {
    workerPath: absolute(workerPath),
    corePath: absolute(core),
    langPath: LANG_PATH.replace('{lang}', language),
    workerBlobURL: false,
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress(message.progress);
      else onStatus(message.status);
    },
  });

  return {
    async recognizePage(image, progress) {
      onProgress = progress;
      const result = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines: Line[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) lines.push(...paragraph.lines);
      }
      return { text: result.data.text, lines };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

export interface RenderedPage {
  blob: Blob;
  viewport: { scale: number; convertToPdfPoint: (x: number, y: number) => number[] };
}

/** Renders one pdf.js page to a PNG at the requested DPI, capped so the canvas stays manageable. */
export async function renderPageForOcr(doc: PDFDocumentProxy, pageNumber: number, dpi: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, MAX_SIDE_PX / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();
  if (!blob) throw new Error(translate('Failed to render page {page}.', { page: pageNumber }));

  return { blob, viewport };
}

export async function pageHasText(doc: PDFDocumentProxy, pageNumber: number): Promise<string | null> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  page.cleanup();
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

function encodable(text: string, supported: Set<number>): string {
  let out = '';
  for (const char of text) {
    if (supported.has(char.codePointAt(0)!)) {
      out += char;
      continue;
    }
    for (const part of char.normalize('NFKD')) {
      if (supported.has(part.codePointAt(0)!)) out += part;
    }
  }
  return out;
}

/** Draws each recognized word as invisible text (render mode 3) over its position on the page. */
export function addTextLayer(pdf: PDFDocument, pageIndex: number, font: PDFFont, rendered: RenderedPage, lines: Line[]): void {
  const page = pdf.getPage(pageIndex);
  const fontName = page.node.newFontDictionary('OcrFont', font.ref);
  const supported = new Set(font.getCharacterSet());
  const { viewport } = rendered;
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];

  for (const line of lines) {
    const lineHeight = line.bbox.y1 - line.bbox.y0;
    const sizePt = Math.max(1, (lineHeight * 0.9) / viewport.scale);

    for (const word of line.words as Word[]) {
      const text = encodable(word.text.trim(), supported);
      if (text === '') continue;

      const baseY = baselineAt(line, word.bbox.x0);
      const [x0, y0] = viewport.convertToPdfPoint(word.bbox.x0, baseY);
      const [x1, y1] = viewport.convertToPdfPoint(word.bbox.x1, baseY);
      const targetWidth = Math.hypot(x1 - x0, y1 - y0);
      const naturalWidth = font.widthOfTextAtSize(text, sizePt);
      if (targetWidth <= 0 || naturalWidth <= 0) continue;

      const angle = Math.atan2(y1 - y0, x1 - x0);
      const sx = targetWidth / naturalWidth;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      ops.push(
        setFontAndSize(fontName, sizePt),
        setTextMatrix(cos * sx, sin * sx, -sin, cos, x0, y0),
        showText(font.encodeText(`${text} `)),
      );
    }
  }

  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

function baselineAt(line: Line, x: number): number {
  const { x0, y0, x1, y1 } = line.baseline;
  const bottom = line.bbox.y1;
  if (x1 <= x0) return bottom;
  const y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  return y >= line.bbox.y0 && y <= bottom ? y : bottom;
}
