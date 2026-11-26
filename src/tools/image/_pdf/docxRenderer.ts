import { toCanvas } from 'html-to-image';
import { translate } from '../../../lib/i18n';
import { prepareDocxBuffer } from '../../_office/prepareDocx';

export interface DocxRenderOptions {
  format: 'image/jpeg' | 'image/png';
  quality?: number;
  onProgress?: (current: number, total: number) => void;
}

export async function renderDocxToImages(
  file: File | Blob,
  baseFilename: string,
  options: DocxRenderOptions,
): Promise<{ name: string; blob: Blob }[]> {
  const cleanBuffer = await prepareDocxBuffer(file);
  const docx = await import('docx-preview');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '816px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#000000';
  container.style.overflow = 'hidden';
  document.body.appendChild(container);

  try {
    await docx.renderAsync(cleanBuffer, container, undefined, {
      inWrapper: false,
      breakPages: true,
      useBase64URL: true,
      ignoreFonts: true,
    });

    let pageElements = Array.from(container.querySelectorAll('section'));
    if (pageElements.length === 0) {
      pageElements = Array.from(container.querySelectorAll('.docx-page, .docx_page'));
    }
    if (pageElements.length === 0) {
      pageElements = (Array.from(container.children) as HTMLElement[]).filter((el) => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT');
    }
    if (pageElements.length === 0) {
      pageElements = [container as unknown as HTMLElement];
    }

    const totalPages = pageElements.length;
    const items: { name: string; blob: Blob }[] = [];
    const ext = options.format === 'image/jpeg' ? 'jpg' : 'png';
    const cleanBase = baseFilename.replace(/\.docx$/i, '');

    for (let idx = 0; idx < totalPages; idx++) {
      options.onProgress?.(idx, totalPages);
      const pageEl = pageElements[idx] as HTMLElement;

      const canvas = await toCanvas(pageEl, {
        pixelRatio: 2,
        skipFonts: true,
        backgroundColor: '#ffffff',
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, options.format, options.format === 'image/jpeg' ? (options.quality ?? 0.92) : undefined),
      );

      canvas.width = 0;
      canvas.height = 0;

      if (!blob?.size || blob.type !== options.format) {
        throw new Error(translate('Failed to rasterize DOCX page {page}', { page: idx + 1 }));
      }

      items.push({
        name: `${cleanBase}-page-${idx + 1}.${ext}`,
        blob,
      });
    }

    options.onProgress?.(totalPages, totalPages);
    return items;
  } finally {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  }
}
