import { PDFDocument } from 'pdf-lib';
import {
  addFittedPage,
  createStage,
  pageGeometry,
  planSlices,
  pxToPt,
  rasterize,
  sanitizeRenderedDom,
  type PageSetup,
} from '../_render/render';
import { neutralizeOfficeRels } from '../../../lib/inertMarkup';

export const LEGACY_DOC_MESSAGE =
  'Legacy .doc files are not supported. Open the file in Word or LibreOffice, save it as .docx, and try again.';

/** Returns an error message when the file is not a usable DOCX, otherwise null. */
export async function checkDocx(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isOle || /\.doc$/i.test(file.name)) return LEGACY_DOC_MESSAGE;

  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) return 'This file is not a valid DOCX document.';

  return null;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Neutralizes external relationship targets in the DOCX archive to prevent remote fetches. */
export async function prepareDocxBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith('.rels')) {
        const relsXml = await file.async('text');
        zip.file(filename, neutralizeOfficeRels(relsXml));
      }
    }
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return buffer;
  }
}

/**
 * docx-preview only breaks pages at explicit page breaks, so a long section can be much
 * taller than the page. Those are cut into page-sized pieces at block boundaries and
 * drawn inside the section's own margins.
 */
async function renderSectionPages(section: HTMLElement): Promise<RenderedPage[]> {
  const style = getComputedStyle(section);
  const width = Math.ceil(section.offsetWidth);
  const total = Math.ceil(section.scrollHeight);
  const pageHeight = Math.ceil(parseFloat(style.minHeight) || section.offsetHeight);

  if (total <= pageHeight * 1.02) {
    return [{ canvas: await rasterize(section, width, Math.max(total, pageHeight)), width, height: Math.max(total, pageHeight) }];
  }

  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const sliceHeight = Math.max(100, pageHeight - padTop - padBottom);
  const slices = planSlices(section, total - padBottom, sliceHeight, padTop);

  const pages: RenderedPage[] = [];
  for (const { y, h } of slices) {
    const slice = await rasterize(section, width, Math.ceil(h), y);
    const ratio = slice.width / width;

    const canvas = document.createElement('canvas');
    canvas.width = slice.width;
    canvas.height = Math.ceil(pageHeight * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing surface.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(slice, 0, Math.round(padTop * ratio));
    slice.width = 0;
    slice.height = 0;

    pages.push({ canvas, width, height: pageHeight });
  }

  return pages;
}

export async function wordToPdf(file: File, setup: PageSetup, onProgress: (ratio: number) => void): Promise<{ blob: Blob; pages: number }> {
  const problem = await checkDocx(file);
  if (problem) throw new Error(problem);

  const cleanBuffer = await prepareDocxBuffer(await file.arrayBuffer());
  const docx = await import('docx-preview');
  const { stage, dispose } = createStage(816);

  try {
    await docx.renderAsync(cleanBuffer, stage, undefined, {
      inWrapper: false,
      breakPages: true,
      useBase64URL: true,
      ignoreFonts: true,
    });
    onProgress(0.2);

    sanitizeRenderedDom(stage);
    const images = Array.from(stage.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

    const sections = Array.from(stage.querySelectorAll<HTMLElement>('section'));
    if (sections.length === 0) throw new Error('No pages could be rendered from this document.');

    const pdf = await PDFDocument.create();

    let pages = 0;

    for (let i = 0; i < sections.length; i++) {
      for (const page of await renderSectionPages(sections[i])) {
        if (setup.size === 'match') {
          await addFittedPage(pdf, page.canvas, page.width, page.height, pxToPt(page.width), pxToPt(page.height), 0, setup.format);
        } else {
          const orientation = page.width > page.height ? 'landscape' : 'portrait';
          const geo = pageGeometry(setup.size, orientation, 0);
          await addFittedPage(pdf, page.canvas, page.width, page.height, geo.widthPt, geo.heightPt, 0, setup.format);
        }
        pages++;
      }

      onProgress(0.2 + (0.75 * (i + 1)) / sections.length);
    }

    const bytes = await pdf.save();
    onProgress(1);
    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      pages,
    };
  } finally {
    dispose();
  }
}
