import type { DetectedFormat } from './detect';
import type { TargetFormat } from './matrix';
import type { BatchResultItem } from '../../components/BatchResults';
import { runFFmpeg } from '../../lib/ffmpeg';
import { decodeImage, loadImage, imageToCanvas, canvasToBlob, encodeBmp, encodeGif, encodeIco } from '../../lib/image';
import { encodeJxlCanvas } from '../../lib/jxl';
import { loadPdfDocument, renderPdfPageToBlob } from '../image/_pdf/pdfRenderer';
import { renderDocxToImages } from '../image/_pdf/docxRenderer';
import { convertOfficeDocument } from './office';

export interface ConvertOptions {
  file: File;
  detected: DetectedFormat;
  target: TargetFormat;
  quality?: number; // 1-100
  bgColor?: string;
  dpi?: number;
  svgScale?: '1x' | '2x' | '4x';
  bitrate?: string;
  icoSize?: number;
  onProgress?: (ratio: number) => void;
}

export type ConvertResult = { type: 'single'; name: string; blob: Blob } | { type: 'batch'; items: BatchResultItem[] };

function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(0, dot) : filename;
}

const NATIVE_OFFICE_DOCUMENTS = new Set([
  'odt',
  'ott',
  'odm',
  'fodt',
  'ods',
  'ots',
  'fods',
  'odp',
  'otp',
  'fodp',
  'odg',
  'otg',
  'fodg',
  'odf',
  'epub',
  'vsdx',
]);
const MAX_XLSX_EXPORT_ROWS = 10_000;
const MAX_XLSX_EXPORT_CELLS = 100_000;

function cachedCellValue(cell: import('exceljs').Cell): string | number | boolean | null {
  const value: unknown = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('result' in record) {
      const result = record.result;
      if (result === null || result === undefined) return null;
      if (result instanceof Date) return result.toISOString();
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return result;
      return null;
    }
    if ('formula' in record || 'sharedFormula' in record) return null;
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : '')).join('');
    }
    if (typeof record.text === 'string') return record.text;
    if (record.error !== undefined) return String(record.error);
  }

  return cell.text || null;
}

function worksheetRows(
  worksheet: import('exceljs').Worksheet,
  budget: { rows: number; cells: number },
): (string | number | boolean | null)[][] {
  if (budget.rows + worksheet.rowCount > MAX_XLSX_EXPORT_ROWS) {
    throw new Error(`Spreadsheet export exceeds the ${MAX_XLSX_EXPORT_ROWS.toLocaleString()}-row limit.`);
  }
  budget.rows += worksheet.rowCount;

  const rows: (string | number | boolean | null)[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    budget.cells += row.cellCount;
    if (budget.cells > MAX_XLSX_EXPORT_CELLS) {
      throw new Error(`Spreadsheet export exceeds the ${MAX_XLSX_EXPORT_CELLS.toLocaleString()}-cell limit.`);
    }
    const values: (string | number | boolean | null)[] = [];
    for (let column = 1; column <= row.cellCount; column++) {
      values.push(cachedCellValue(row.getCell(column)));
    }
    rows[rowNumber - 1] = values;
  });
  return rows;
}

function quoteDelimitedValue(value: string | number | boolean | null, delimiter: string): string {
  const text = value === null ? '' : String(value);
  if (text.includes(delimiter) || /["\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function convertXlsxData(file: File, targetId: string, outName: string): Promise<ConvertResult> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('Could not read the spreadsheet. The file may be corrupt.');
  }

  const budget = { rows: 0, cells: 0 };
  if (targetId === 'json') {
    const worksheets = Object.fromEntries(workbook.worksheets.map((worksheet) => [worksheet.name, worksheetRows(worksheet, budget)]));
    return { type: 'single', name: outName, blob: new Blob([JSON.stringify(worksheets, null, 2)], { type: 'application/json' }) };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('The spreadsheet contains no worksheets to export.');
  const delimiter = targetId === 'csv' ? ',' : '\t';
  const rows = worksheetRows(worksheet, budget).map((row) => row.map((value) => quoteDelimitedValue(value, delimiter)).join(delimiter));
  const mime = targetId === 'csv' ? 'text/csv' : targetId === 'tsv' ? 'text/tab-separated-values' : 'text/plain';
  return { type: 'single', name: outName, blob: new Blob([rows.join('\n')], { type: mime }) };
}

function resolvePackagePath(baseDir: string, target: string): string {
  const segments = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

async function extractPptxText(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const presentationFile = zip.file('ppt/presentation.xml');
  const relationshipsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presentationFile || !relationshipsFile) throw new Error('Invalid PPTX presentation.');

  const parser = new DOMParser();
  const presentation = parser.parseFromString(await presentationFile.async('text'), 'application/xml');
  const relationships = parser.parseFromString(await relationshipsFile.async('text'), 'application/xml');
  if (presentation.querySelector('parsererror') || relationships.querySelector('parsererror')) {
    throw new Error('Could not read the presentation slide order.');
  }

  const targets = new Map<string, string>();
  for (const relationship of Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))) {
    if (relationship.getAttribute('TargetMode')?.toLowerCase() === 'external') continue;
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) targets.set(id, target);
  }

  const slideIds = Array.from(presentation.getElementsByTagNameNS('*', 'sldId'));
  const slidePaths = slideIds
    .map((slideId) => {
      const relationshipId =
        slideId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || slideId.getAttribute('r:id');
      const target = relationshipId ? targets.get(relationshipId) : undefined;
      return target ? resolvePackagePath('ppt', target) : null;
    })
    .filter((path): path is string => !!path);

  if (slidePaths.length === 0) {
    slidePaths.push(
      ...Object.keys(zip.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1])),
    );
  }
  if (slidePaths.length === 0) throw new Error('No slides were found in this presentation.');

  const slideText: string[] = [];
  for (let index = 0; index < slidePaths.length; index++) {
    const slideFile = zip.file(slidePaths[index]);
    if (!slideFile) continue;
    const slide = parser.parseFromString(await slideFile.async('text'), 'application/xml');
    const paragraphs = Array.from(slide.getElementsByTagNameNS('*', 'p'));
    const lines = paragraphs.map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS('*', 't'))
        .map((run) => run.textContent || '')
        .join(''),
    );
    const text = (lines.length > 0 ? lines : Array.from(slide.getElementsByTagNameNS('*', 't')).map((run) => run.textContent || ''))
      .filter((line) => line.trim())
      .join('\n');
    slideText.push(`--- Slide ${index + 1} ---\n${text}`);
  }
  return slideText.join('\n\n');
}

async function loadSvgCanvas(file: File, scaleStr: '1x' | '2x' | '4x'): Promise<HTMLCanvasElement> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;

  let w = parseFloat(root.getAttribute('width') || '');
  let h = parseFloat(root.getAttribute('height') || '');
  if (!w || !h || isNaN(w) || isNaN(h)) {
    const viewBox = root
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      w = viewBox[2];
      h = viewBox[3];
    } else {
      w = 512;
      h = 512;
    }
  }

  const multiplier = scaleStr === '4x' ? 4 : scaleStr === '2x' ? 2 : 1;
  const targetW = Math.round(w * multiplier);
  const targetH = Math.round(h * multiplier);

  root.setAttribute('width', String(targetW));
  root.setAttribute('height', String(targetH));

  const modifiedBlob = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
  const img = await loadImage(modifiedBlob);
  return imageToCanvas(img, targetW, targetH);
}

export async function executeConversion(options: ConvertOptions): Promise<ConvertResult> {
  const {
    file,
    detected,
    target,
    quality = 90,
    bgColor = '#ffffff',
    dpi = 150,
    svgScale = '2x',
    bitrate = '192k',
    icoSize = 64,
    onProgress,
  } = options;
  const baseName = getBaseName(file.name);
  const outName = `${baseName}.${target.ext}`;

  if (detected.family === 'document' && NATIVE_OFFICE_DOCUMENTS.has(detected.id)) {
    const blob = await convertOfficeDocument(file, detected.id, target.id);
    return { type: 'single', name: outName, blob };
  }

  // -------------------------------------------------------------
  // PATH 1: Image Input
  // -------------------------------------------------------------
  if (detected.family === 'image') {
    // 1A. Animated GIF to Video (MP4 / WebM)
    if (detected.id === 'gif' && (target.id === 'mp4' || target.id === 'webm')) {
      const inputName = 'input.gif';
      const outputName = target.id === 'mp4' ? 'output.mp4' : 'output.webm';
      const args =
        target.id === 'mp4'
          ? [
              '-i',
              inputName,
              '-c:v',
              'libx264',
              '-pix_fmt',
              'yuv420p',
              '-vf',
              'scale=trunc(iw/2)*2:trunc(ih/2)*2',
              '-movflags',
              '+faststart',
              outputName,
            ]
          : [
              '-i',
              inputName,
              '-c:v',
              'libvpx',
              '-deadline',
              'good',
              '-cpu-used',
              '4',
              '-b:v',
              '1M',
              '-crf',
              '10',
              '-pix_fmt',
              'yuv420p',
              '-vf',
              'scale=trunc(iw/2)*2:trunc(ih/2)*2',
              outputName,
            ];

      const blob = await runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args,
        output: outputName,
        onProgress,
      });
      return { type: 'single', name: outName, blob };
    }

    // 1B. Decode image to canvas
    let canvas: HTMLCanvasElement;
    if (detected.id === 'svg') {
      canvas = await loadSvgCanvas(file, svgScale);
    } else if (detected.id === 'tiff') {
      // ffmpeg.wasm decodes TIFF to PNG first
      const pngBlob = await runFFmpeg({
        inputs: [{ name: 'input.tiff', data: file }],
        args: ['-i', 'input.tiff', 'temp.png'],
        output: 'temp.png',
        onProgress: (r) => onProgress?.(r * 0.5),
      });
      const img = await loadImage(pngBlob);
      canvas = imageToCanvas(img);
    } else {
      const img = await decodeImage(file);
      canvas = imageToCanvas(img);
    }

    // 1C. Convert canvas to target format
    const clampedQ = Math.max(0.01, Math.min(1, quality / 100));

    if (target.id === 'pdf') {
      const pngBlob = await canvasToBlob(canvas, 'image/png');
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const pngBytes = await pngBlob.arrayBuffer();
      const embedded = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      const pdfBytes = await pdfDoc.save();
      const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
      return { type: 'single', name: outName, blob: new Blob([buf], { type: 'application/pdf' }) };
    }

    if (target.id === 'ico') {
      const size = Math.min(256, Math.max(16, icoSize));
      const icoCanvas = imageToCanvas(canvas, size, size);
      const icoBlob = await encodeIco([icoCanvas]);
      return { type: 'single', name: outName, blob: icoBlob };
    }

    if (target.id === 'bmp') {
      // Flatten alpha on bgColor
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = bgColor || '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      return { type: 'single', name: outName, blob: encodeBmp(flat) };
    }

    if (target.id === 'gif') {
      const gifBlob = await encodeGif(canvas);
      return { type: 'single', name: outName, blob: gifBlob };
    }

    if (target.id === 'jpg') {
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = bgColor || '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      const blob = await canvasToBlob(flat, 'image/jpeg', clampedQ);
      return { type: 'single', name: outName, blob };
    }

    if (target.id === 'png') {
      const blob = await canvasToBlob(canvas, 'image/png');
      return { type: 'single', name: outName, blob };
    }

    if (target.id === 'webp') {
      const blob = await canvasToBlob(canvas, 'image/webp', clampedQ);
      return { type: 'single', name: outName, blob };
    }

    if (target.id === 'avif') {
      const blob = await canvasToBlob(canvas, 'image/avif', clampedQ);
      return { type: 'single', name: outName, blob };
    }

    if (target.id === 'jxl') {
      const isLossless = quality === 100;
      const jxlBlob = await encodeJxlCanvas(canvas, { quality, lossless: isLossless });
      return { type: 'single', name: outName, blob: jxlBlob };
    }
  }

  // -------------------------------------------------------------
  // PATH 2: Video Input (or Audio Input to Audio)
  // -------------------------------------------------------------
  if (detected.family === 'video' || detected.family === 'audio') {
    const inputExt = detected.ext || 'bin';
    const inputName = `input.${inputExt}`;
    const outputName = `output.${target.ext}`;

    const ffmpegArgs: string[] = ['-i', inputName];

    if (target.id === 'mp4') {
      ffmpegArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
    } else if (target.id === 'webm') {
      // VP8 (not VP9 to avoid crashes in ffmpeg.wasm 0.12)
      ffmpegArgs.push(
        '-c:v',
        'libvpx',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-b:v',
        '1M',
        '-crf',
        '10',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'libopus',
        '-b:a',
        '96k',
      );
    } else if (target.id === 'mov') {
      ffmpegArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k');
    } else if (target.id === 'mkv') {
      ffmpegArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k');
    } else if (target.id === 'avi') {
      ffmpegArgs.push('-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-q:a', '4');
    } else if (target.id === 'gif') {
      ffmpegArgs.push(
        '-vf',
        'fps=15,scale=trunc(iw/2)*2:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
        '-an',
        '-loop',
        '0',
      );
    } else if (target.id === 'mp3') {
      ffmpegArgs.push('-vn', '-c:a', 'libmp3lame', '-b:a', bitrate);
    } else if (target.id === 'm4a') {
      ffmpegArgs.push('-vn', '-c:a', 'aac', '-b:a', bitrate);
    } else if (target.id === 'wav') {
      ffmpegArgs.push('-vn', '-c:a', 'pcm_s16le');
    } else if (target.id === 'ogg') {
      ffmpegArgs.push('-vn', '-c:a', 'libvorbis', '-q:a', '4');
    } else if (target.id === 'flac') {
      ffmpegArgs.push('-vn', '-c:a', 'flac');
    } else if (target.id === 'opus') {
      ffmpegArgs.push('-vn', '-c:a', 'libopus', '-b:a', bitrate || '96k');
    }

    ffmpegArgs.push(outputName);

    const blob = await runFFmpeg({
      inputs: [{ name: inputName, data: file }],
      args: ffmpegArgs,
      output: outputName,
      onProgress,
    });

    return { type: 'single', name: outName, blob };
  }

  // -------------------------------------------------------------
  // PATH 3: PDF Document Input
  // -------------------------------------------------------------
  if (detected.id === 'pdf') {
    if (target.id === 'txt') {
      const pdfDoc = await loadPdfDocument(file);
      const textChunks: string[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        onProgress?.(i / pdfDoc.numPages);
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const str = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        textChunks.push(`--- Page ${i} ---\n${str}`);
      }
      const fullText = textChunks.join('\n\n');
      return { type: 'single', name: outName, blob: new Blob([fullText], { type: 'text/plain' }) };
    }

    if (target.id === 'png' || target.id === 'jpg') {
      const pdfDoc = await loadPdfDocument(file);
      const scale = dpi / 72;
      const mime = target.id === 'jpg' ? 'image/jpeg' : 'image/png';
      const ext = target.id === 'jpg' ? 'jpg' : 'png';
      const numPages = pdfDoc.numPages;
      const clampedQ = Math.max(0.01, Math.min(1, quality / 100));

      const items: BatchResultItem[] = [];
      for (let i = 1; i <= numPages; i++) {
        onProgress?.((i - 1) / numPages);
        const pageBlob = await renderPdfPageToBlob(pdfDoc, i, scale, mime, clampedQ);
        const itemName = numPages === 1 ? `${baseName}.${ext}` : `${baseName}-page-${i}.${ext}`;
        items.push({ name: itemName, blob: pageBlob });
      }
      onProgress?.(1);

      if (items.length === 1) {
        return { type: 'single', name: items[0].name, blob: items[0].blob };
      }
      return { type: 'batch', items };
    }
  }

  // -------------------------------------------------------------
  // PATH 4: XLSX and PPTX document inputs
  // -------------------------------------------------------------
  if (detected.id === 'xlsx') {
    if (target.id === 'pdf') {
      const [{ excelToPdf }, { DEFAULT_PAGE_SETUP }] = await Promise.all([
        import('../pdf/excel-to-pdf/convert'),
        import('../pdf/_render/render'),
      ]);
      const result = await excelToPdf(file, DEFAULT_PAGE_SETUP, onProgress || (() => undefined));
      return { type: 'single', name: outName, blob: result.blob };
    }
    return convertXlsxData(file, target.id, outName);
  }

  if (detected.id === 'pptx') {
    if (target.id === 'pdf') {
      const [{ powerpointToPdf }, { DEFAULT_PAGE_SETUP }] = await Promise.all([
        import('../pdf/powerpoint-to-pdf/convert'),
        import('../pdf/_render/render'),
      ]);
      const result = await powerpointToPdf(file, DEFAULT_PAGE_SETUP, onProgress || (() => undefined));
      return { type: 'single', name: outName, blob: result.blob };
    }
    if (target.id === 'txt') {
      const text = await extractPptxText(file);
      return { type: 'single', name: outName, blob: new Blob([text], { type: 'text/plain' }) };
    }
  }

  // -------------------------------------------------------------
  // PATH 5: DOCX / DOTX Document Input
  // -------------------------------------------------------------
  if (detected.id === 'docx' || detected.id === 'dotx') {
    if (target.id === 'html') {
      const { renderAsync } = await import('docx-preview');
      const container = document.createElement('div');
      const buf = await file.arrayBuffer();
      await renderAsync(buf, container);
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title></head><body>${container.innerHTML}</body></html>`;
      return { type: 'single', name: outName, blob: new Blob([fullHtml], { type: 'text/html' }) };
    }

    if (target.id === 'pdf') {
      const images = await renderDocxToImages(file, baseName, {
        format: 'image/png',
        onProgress: (cur, tot) => onProgress?.(tot > 0 ? (cur / tot) * 0.7 : 0.35),
      });
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();

      for (let i = 0; i < images.length; i++) {
        onProgress?.(0.7 + (i / images.length) * 0.3);
        const imgBlob = images[i].blob;
        const imgBytes = await imgBlob.arrayBuffer();
        const embedded = await pdfDoc.embedPng(imgBytes);
        const page = pdfDoc.addPage([embedded.width, embedded.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      }

      const pdfBytes = await pdfDoc.save();
      const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
      return { type: 'single', name: outName, blob: new Blob([buf], { type: 'application/pdf' }) };
    }

    if (target.id === 'png' || target.id === 'jpg') {
      const images = await renderDocxToImages(file, baseName, {
        format: target.id === 'jpg' ? 'image/jpeg' : 'image/png',
        onProgress: (cur, tot) => onProgress?.(tot > 0 ? cur / tot : 0.5),
      });
      if (images.length === 1) {
        return { type: 'single', name: outName, blob: images[0].blob };
      }
      const items: BatchResultItem[] = images.map((item, idx) => ({
        name: `${baseName}-page-${idx + 1}.${target.ext}`,
        blob: item.blob,
      }));
      return { type: 'batch', items };
    }

    if (target.id === 'txt') {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const xmlFile = zip.file('word/document.xml');
      if (!xmlFile) throw new Error('Invalid DOCX document.');
      const xmlText = await xmlFile.async('text');
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
      const textLines = paragraphs.map((p) => p.textContent || '').filter((t) => t.trim().length > 0);
      return { type: 'single', name: outName, blob: new Blob([textLines.join('\n\n')], { type: 'text/plain' }) };
    }
  }

  // -------------------------------------------------------------
  // PATH 6: Text / Structured Data Input
  // -------------------------------------------------------------
  if (detected.family === 'text') {
    const rawText = await file.text();

    if (detected.id === 'json') {
      const parsed = JSON.parse(rawText);
      if (target.id === 'json') {
        const pretty = JSON.stringify(parsed, null, 2);
        return { type: 'single', name: outName, blob: new Blob([pretty], { type: 'application/json' }) };
      }
      if (target.id === 'csv') {
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const headers = Array.from(new Set(rows.flatMap((r) => (typeof r === 'object' && r !== null ? Object.keys(r) : []))));
        const csvRows = [headers.join(',')];
        for (const row of rows) {
          const values = headers.map((h) => {
            const val = row[h] === undefined || row[h] === null ? '' : String(row[h]);
            return `"${val.replace(/"/g, '""')}"`;
          });
          csvRows.push(values.join(','));
        }
        return { type: 'single', name: outName, blob: new Blob([csvRows.join('\n')], { type: 'text/csv' }) };
      }
    }

    if (detected.id === 'csv' || detected.id === 'tsv') {
      const fromDelim = detected.id === 'tsv' ? '\t' : ',';
      const toDelim = target.id === 'tsv' ? '\t' : ',';

      if (target.id === 'json') {
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          return { type: 'single', name: outName, blob: new Blob(['[]'], { type: 'application/json' }) };
        }
        const headers = lines[0].split(fromDelim).map((h) => h.replace(/^"|"$/g, '').trim());
        const dataRows = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(fromDelim).map((c) => c.replace(/^"|"$/g, '').trim());
          const obj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            obj[h] = cells[idx] ?? '';
          });
          dataRows.push(obj);
        }
        return { type: 'single', name: outName, blob: new Blob([JSON.stringify(dataRows, null, 2)], { type: 'application/json' }) };
      }

      if (target.id === 'csv' || target.id === 'tsv') {
        const lines = rawText.split(/\r?\n/);
        const converted = lines
          .map((line) => {
            const parts = line.split(fromDelim);
            return parts.join(toDelim);
          })
          .join('\n');
        const mime = target.id === 'csv' ? 'text/csv' : 'text/tab-separated-values';
        return { type: 'single', name: outName, blob: new Blob([converted], { type: mime }) };
      }
    }

    if (detected.id === 'txt' && target.id === 'pdf') {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 11;
      const margin = 50;
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const textWidth = pageWidth - margin * 2;
      const lineHeight = fontSize * 1.4;

      const lines = rawText.split(/\r?\n/);
      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      for (const line of lines) {
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(line.slice(0, Math.floor(textWidth / (fontSize * 0.5))), {
          x: margin,
          y,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= lineHeight;
      }

      const pdfBytes = await pdfDoc.save();
      const buf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
      return { type: 'single', name: outName, blob: new Blob([buf], { type: 'application/pdf' }) };
    }
  }

  throw new Error(`Conversion from ${detected.label} to ${target.label} is not supported.`);
}
