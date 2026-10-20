import { toCanvas } from 'html-to-image';
import { PDFDocument, type PDFImage } from 'pdf-lib';

export type PageSizeId = 'a4' | 'letter' | 'match';
export type Orientation = 'portrait' | 'landscape';
export type ImageFormat = 'jpeg' | 'png';

export interface PageSetup {
  size: PageSizeId;
  orientation: Orientation;
  marginMm: number;
  format: ImageFormat;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'a4',
  orientation: 'portrait',
  marginMm: 15,
  format: 'jpeg',
};

export interface PageGeometry {
  widthPt: number;
  heightPt: number;
  marginPt: number;
  contentWpt: number;
  contentHpt: number;
  contentWpx: number;
  contentHpx: number;
}

const PAGE_PT: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const PX_PER_PT = 96 / 72;
const PT_PER_PX = 72 / 96;
const PT_PER_MM = 72 / 25.4;
const PIXEL_RATIO = 2;
const JPEG_QUALITY = 0.9;

export function pageGeometry(
  size: 'a4' | 'letter',
  orientation: Orientation,
  marginMm: number
): PageGeometry {
  const [w, h] = PAGE_PT[size];
  const widthPt = orientation === 'portrait' ? w : h;
  const heightPt = orientation === 'portrait' ? h : w;
  const marginPt = marginMm * PT_PER_MM;
  const contentWpt = widthPt - 2 * marginPt;
  const contentHpt = heightPt - 2 * marginPt;

  return {
    widthPt,
    heightPt,
    marginPt,
    contentWpt,
    contentHpt,
    contentWpx: Math.floor(contentWpt * PX_PER_PT),
    contentHpx: Math.floor(contentHpt * PX_PER_PT),
  };
}

/** Off-screen holder inside a CSP-constrained iframe to guarantee no network fetches during layout. */
export function createStage(widthPx: number): { stage: HTMLDivElement; dispose: () => void } {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.position = 'fixed';
  iframe.style.left = '-20000px';
  iframe.style.top = '0';
  iframe.style.width = `${widthPx}px`;
  iframe.style.height = '1000px';
  iframe.style.border = 'none';
  iframe.style.background = '#ffffff';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    const stage = document.createElement('div');
    stage.style.position = 'fixed';
    stage.style.left = '-20000px';
    stage.style.top = '0';
    stage.style.width = `${widthPx}px`;
    stage.style.background = '#ffffff';
    stage.style.color = '#000000';
    stage.style.pointerEvents = 'none';
    document.body.appendChild(stage);
    return { stage, dispose: () => stage.remove() };
  }

  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;">
  </head><body style="margin:0;padding:0;background:#ffffff;color:#000000;width:${widthPx}px;">
    <div id="stage" style="width:${widthPx}px;background:#ffffff;color:#000000;"></div>
  </body></html>`);
  doc.close();

  const stage = (doc.getElementById('stage') || doc.body) as HTMLDivElement;

  return {
    stage,
    dispose: () => iframe.remove(),
  };
}

/**
 * Strips active scripts, external image references, and outbound links from
 * rendered DOM nodes to guarantee user privacy and prevent network leaks.
 */
export function sanitizeRenderedDom(root: HTMLElement): void {
  // Remove script and noscript elements
  root.querySelectorAll('script, noscript').forEach((el) => el.remove());

  // Remove base elements that could hijack relative URLs
  root.querySelectorAll('base').forEach((el) => el.remove());

  // Remove event handler attributes (onclick, onload, etc.) and external style urls
  const allElements = root.querySelectorAll('*');
  for (const el of Array.from(allElements)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
      if (attr.name.toLowerCase() === 'style') {
        let val = attr.value;
        if (/url\s*\(/i.test(val)) {
          val = val.replace(/url\s*\(\s*['"]?(?!data:|blob:)[^'")]+['"]?\s*\)/gi, 'none');
          el.setAttribute('style', val);
        }
      }
    }
  }

  // Remove external stylesheets or preloads
  root.querySelectorAll('link').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('data:') && !href.startsWith('blob:')) {
      link.remove();
    }
  });

  // Neutralize external images (keep only data: and blob:)
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.remove();
      return;
    }
    img.removeAttribute('srcset');
  });

  // Neutralize SVG images
  root.querySelectorAll('image').forEach((img) => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
    if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
      img.removeAttribute('href');
      img.removeAttribute('xlink:href');
    }
  });

  // Remove outbound link targets
  root.querySelectorAll('a').forEach((a) => {
    a.removeAttribute('href');
    a.removeAttribute('target');
  });

  // Remove embedded iframes, media, or forms
  root.querySelectorAll('iframe, object, embed, video, audio, form, input[type="image"]').forEach((el) => el.remove());
}

export function rasterize(
  el: HTMLElement,
  width: number,
  height: number,
  offsetY = 0
): Promise<HTMLCanvasElement> {
  return toCanvas(el, {
    pixelRatio: PIXEL_RATIO,
    skipFonts: true,
    backgroundColor: '#ffffff',
    width,
    height,
    filter: (domNode) => {
      if (domNode instanceof HTMLScriptElement) return false;
      if (domNode instanceof HTMLIFrameElement) return false;
      return true;
    },
    style: offsetY
      ? {
          transform: `translateY(${-offsetY}px)`,
          transformOrigin: 'top left',
          // The clone is shifted up, so its own box must not clip the rest of the content.
          overflow: 'visible',
          height: `${el.scrollHeight}px`,
        }
      : undefined,
  });
}

export async function embedCanvas(
  pdf: PDFDocument,
  canvas: HTMLCanvasElement,
  format: ImageFormat
): Promise<PDFImage> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', JPEG_QUALITY)
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Could not encode a rendered page.');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return format === 'png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

/** Tops (px, relative to the root) where a page may break without splitting a block. */
function collectBreakTops(root: HTMLElement, maxHeight: number): number[] {
  const view = root.ownerDocument.defaultView;
  if (!view) return [];

  const rootTop = root.getBoundingClientRect().top;
  const tops = new Set<number>();

  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const display = view.getComputedStyle(child).display;
      if (display === 'none' || display === 'contents' || display.startsWith('inline')) {
        if (display !== 'inline-block' && display !== 'inline-flex') continue;
      }

      const rect = child.getBoundingClientRect();
      const top = Math.round(rect.top - rootTop);
      if (top > 0 && top < maxHeight) tops.add(top);
      walk(child);
    }
  };

  walk(root);
  return Array.from(tops).sort((a, b) => a - b);
}

export function planSlices(
  el: HTMLElement,
  totalHeight: number,
  sliceHeight: number,
  initialOffset = 0
): { y: number; h: number }[] {
  const candidateTops = collectBreakTops(el, totalHeight);
  const slices: { y: number; h: number }[] = [];
  let start = initialOffset;

  while (start < totalHeight) {
    const ideal = start + sliceHeight;
    if (ideal >= totalHeight) {
      slices.push({ y: start, h: totalHeight - start });
      break;
    }

    const minCut = start + sliceHeight * 0.65;
    let cut = ideal;
    for (let i = candidateTops.length - 1; i >= 0; i--) {
      const top = candidateTops[i];
      if (top <= ideal && top >= minCut) {
        cut = top;
        break;
      }
    }

    slices.push({ y: start, h: cut - start });
    start = cut;
  }

  return slices;
}

/**
 * Rasterizes a laid-out element and appends it to the PDF as one or more pages,
 * breaking between block elements where possible. Returns the number of pages added.
 */
export async function addElementPages(
  pdf: PDFDocument,
  el: HTMLElement,
  geo: PageGeometry,
  format: ImageFormat,
  onPage?: (done: number, total: number) => void
): Promise<number> {
  sanitizeRenderedDom(el);
  const images = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

  const width = Math.max(1, Math.ceil(el.scrollWidth));
  const totalHeight = Math.max(1, Math.ceil(el.scrollHeight));

  const scale = Math.min(1, geo.contentWpx / width);
  const sliceHeight = geo.contentHpx / scale;
  const slices = planSlices(el, totalHeight, sliceHeight);

  for (let i = 0; i < slices.length; i++) {
    onPage?.(i, slices.length);
    const { y, h } = slices[i];

    const canvas = await rasterize(el, width, Math.ceil(h), y);
    const image = await embedCanvas(pdf, canvas, format);

    const drawW = width * PT_PER_PX * scale;
    const drawH = h * PT_PER_PX * scale;
    const page = pdf.addPage([geo.widthPt, geo.heightPt]);
    page.drawImage(image, {
      x: geo.marginPt,
      y: geo.heightPt - geo.marginPt - drawH,
      width: drawW,
      height: drawH,
    });
  }

  onPage?.(slices.length, slices.length);
  return slices.length;
}

/** Adds one page holding the canvas, scaled to fit inside the page and centred. */
export async function addFittedPage(
  pdf: PDFDocument,
  canvas: HTMLCanvasElement,
  sourceWpx: number,
  sourceHpx: number,
  pageWpt: number,
  pageHpt: number,
  marginPt: number,
  format: ImageFormat
): Promise<void> {
  const image = await embedCanvas(pdf, canvas, format);

  const availW = pageWpt - 2 * marginPt;
  const availH = pageHpt - 2 * marginPt;
  const scale = Math.min(availW / sourceWpx, availH / sourceHpx);
  const drawW = sourceWpx * scale;
  const drawH = sourceHpx * scale;

  const page = pdf.addPage([pageWpt, pageHpt]);
  page.drawImage(image, {
    x: (pageWpt - drawW) / 2,
    y: (pageHpt - drawH) / 2,
    width: drawW,
    height: drawH,
  });
}

export function pxToPt(px: number): number {
  return px * PT_PER_PX;
}

export function pdfFileName(file: File | null, fallback: string): string {
  if (!file) return fallback;
  const base = file.name.replace(/\.[^.]+$/, '') || 'document';
  return `${base}.pdf`;
}
