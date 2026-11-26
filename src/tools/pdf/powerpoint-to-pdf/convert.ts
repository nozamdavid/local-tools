import { PDFDocument } from 'pdf-lib';
import { addFittedPage, createStage, pageGeometry, pxToPt, rasterize, sanitizeRenderedDom, type PageSetup } from '../_render/render';
import { prepareOfficeBuffer } from '../../_office/prepareOffice';
import { applyChartText, prepareChartText, type ChartText } from './chartText';

const SLIDE_WIDTH_PX = 960;

export const LEGACY_PPT_MESSAGE =
  'Legacy .ppt files are not supported. Open the file in PowerPoint or LibreOffice, save it as .pptx, and try again.';

const PPTX_PREPARATION_ERROR =
  'Could not prepare this PPTX presentation. Open it in PowerPoint or LibreOffice, save a fresh .pptx copy, and try again.';

export async function checkPptx(file: File): Promise<string | null> {
  const header = await file
    .slice(0, 4)
    .arrayBuffer()
    .catch(() => null);
  if (!header) return PPTX_PREPARATION_ERROR;
  const head = new Uint8Array(header);
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (isOle || /\.ppt$/i.test(file.name)) return LEGACY_PPT_MESSAGE;

  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) return 'This file is not a valid PPTX presentation.';

  return null;
}

/** Strips dangling content-type overrides and neutralizes external relationships. */
export function preparePptxBuffer(input: Blob | ArrayBuffer, chartText?: Map<string, ChartText>): Promise<ArrayBuffer> {
  return prepareOfficeBuffer(input, PPTX_PREPARATION_ERROR, async (zip) => {
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
      if (chartText) await prepareChartText(zip, ctXml, chartText);
    }
  });
}

export async function powerpointToPdf(
  file: File,
  setup: PageSetup,
  onProgress: (ratio: number) => void,
): Promise<{ blob: Blob; pages: number }> {
  const problem = await checkPptx(file);
  if (problem) throw new Error(problem);

  const chartText = new Map<string, ChartText>();
  const cleanBuffer = await preparePptxBuffer(file, chartText);
  const { init } = await import('pptx-preview');
  const { stage, dispose } = createStage(SLIDE_WIDTH_PX);
  let previewer: ReturnType<typeof init> | undefined;

  try {
    previewer = init(stage, { width: SLIDE_WIDTH_PX, mode: 'list' });
    const pptx = await previewer.load(cleanBuffer);
    applyChartText([...pptx.slides, ...pptx.slideLayouts, ...pptx.slideMaster], chartText);
    for (let i = 0; i < pptx.slides.length; i++) {
      previewer.htmlRender.renderSlide(i);
    }
    // pptx-preview queues chart SVG creation with setTimeout after laying out each slide.
    if (stage.querySelector('.chart-node')) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
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
        await addFittedPage(pdf, canvas, width, height, geo.widthPt, geo.heightPt, geo.marginPt, setup.format);
      }

      onProgress(0.2 + (0.75 * (i + 1)) / slides.length);
    }

    const bytes = await pdf.save();
    onProgress(1);
    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      pages: slides.length,
    };
  } finally {
    try {
      previewer?.destroy();
    } finally {
      dispose();
    }
  }
}
