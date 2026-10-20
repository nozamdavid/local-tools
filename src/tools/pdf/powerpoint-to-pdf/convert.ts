import { PDFDocument } from 'pdf-lib';
import {
  addFittedPage,
  createStage,
  pageGeometry,
  pxToPt,
  rasterize,
  sanitizeRenderedDom,
  type PageSetup,
} from '../_render/render';

const SLIDE_WIDTH_PX = 960;

export const LEGACY_PPT_MESSAGE =
  'Legacy .ppt files are not supported. Open the file in PowerPoint or LibreOffice, save it as .pptx, and try again.';

export async function checkPptx(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isOle || /\.ppt$/i.test(file.name)) return LEGACY_PPT_MESSAGE;

  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) return 'This file is not a valid PPTX presentation.';

  return null;
}

/** Strips dangling content-type overrides and neutralizes external relationships. */
async function preparePptxBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      let ctXml = await ctFile.async('text');
      ctXml = ctXml.replace(/<Override\s+[^>]*PartName="([^"]+)"[^>]*\/>/gi, (match, partName) => {
        const cleanPath = partName.startsWith('/') ? partName.slice(1) : partName;
        if (!zip.files[cleanPath]) {
          return '';
        }
        return match;
      });
      zip.file('[Content_Types].xml', ctXml);
    }
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith('.rels')) {
        let relsXml = await file.async('text');
        relsXml = relsXml.replace(
          /<Relationship\s+([^>]*TargetMode="External"[^>]*)\/>/gi,
          (match) => match.replace(/Target="[^"]*"/i, 'Target="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA="')
        );
        relsXml = relsXml.replace(
          /<Relationship\s+([^>]*Target="https?:\/\/[^"]*"[^>]*)\/>/gi,
          (match) => match.replace(/Target="[^"]*"/i, 'Target="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA="')
        );
        zip.file(filename, relsXml);
      }
    }
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    // If zip processing fails, fall back to original buffer
  }
  return buffer;
}

export async function powerpointToPdf(
  file: File,
  setup: PageSetup,
  onProgress: (ratio: number) => void
): Promise<{ blob: Blob; pages: number }> {
  const problem = await checkPptx(file);
  if (problem) throw new Error(problem);

  const cleanBuffer = await preparePptxBuffer(await file.arrayBuffer());
  const { init } = await import('pptx-preview');
  const { stage, dispose } = createStage(SLIDE_WIDTH_PX);

  try {
    const previewer = init(stage, { width: SLIDE_WIDTH_PX, mode: 'list' });
    await previewer.preview(cleanBuffer);
    onProgress(0.2);

    sanitizeRenderedDom(stage);
    const images = Array.from(stage.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

    const slides = Array.from(stage.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper'));
    if (slides.length === 0) throw new Error('No slides could be rendered from this presentation.');

    const pdf = await PDFDocument.create();

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const width = Math.ceil(slide.offsetWidth);
      const height = Math.ceil(slide.offsetHeight);

      const canvas = await rasterize(slide, width, height);

      if (setup.size === 'match') {
        await addFittedPage(pdf, canvas, width, height, pxToPt(width), pxToPt(height), 0, setup.format);
      } else {
        const geo = pageGeometry(setup.size, 'landscape', setup.marginMm);
        await addFittedPage(
          pdf,
          canvas,
          width,
          height,
          geo.widthPt,
          geo.heightPt,
          geo.marginPt,
          setup.format
        );
      }

      onProgress(0.2 + (0.75 * (i + 1)) / slides.length);
    }

    previewer.destroy();
    const bytes = await pdf.save();
    onProgress(1);
    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      pages: slides.length,
    };
  } finally {
    dispose();
  }
}
