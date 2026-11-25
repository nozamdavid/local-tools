import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { getVisualPageDims, hexToRgb, mapVisualToPdf } from '../_stamp/coords';
import type { Annotation } from './types';

/** Converts a base64 / data URL string to Uint8Array bytes */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const parts = dataUrl.split(',');
  const header = parts[0];
  const b64 = parts[1];
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mime };
}

/**
 * Applies a list of annotations to a loaded PDFDocument.
 * Uses visual coordinate mapping to correctly handle rotated pages (0, 90, 180, 270 deg).
 */
export async function applyAnnotations(doc: PDFDocument, annotations: Annotation[]): Promise<void> {
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Group annotations by pageNum (1-based)
  const byPage = new Map<number, Annotation[]>();
  for (const ann of annotations) {
    const list = byPage.get(ann.pageNum) ?? [];
    list.push(ann);
    byPage.set(ann.pageNum, list);
  }

  for (const [pageNum, pageAnns] of byPage.entries()) {
    if (pageNum < 1 || pageNum > pages.length) continue;
    const page = pages[pageNum - 1];
    // PDF.js previews the CropBox intersected with the MediaBox. Keep exports
    // in that same visible coordinate space, including nonzero box origins.
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    const left = Math.max(media.x, crop.x);
    const bottom = Math.max(media.y, crop.y);
    const right = Math.min(media.x + media.width, crop.x + crop.width);
    const top = Math.min(media.y + media.height, crop.y + crop.height);
    const box = right > left && top > bottom ? { x: left, y: bottom, width: right - left, height: top - bottom } : media;
    const dims = getVisualPageDims(page);
    dims.pdfWidth = box.width;
    dims.pdfHeight = box.height;
    const sideways = dims.rotation === 90 || dims.rotation === 270;
    dims.visualWidth = sideways ? box.height : box.width;
    dims.visualHeight = sideways ? box.width : box.height;
    const place = (x: number, y: number) => {
      const point = mapVisualToPdf({ x, y, angle: 0 }, dims);
      return { ...point, x: point.x + box.x, y: point.y + box.y };
    };

    for (const ann of pageAnns) {
      const xv = dims.visualWidth * (ann.xPercent / 100);
      const yv = dims.visualHeight * (ann.yPercent / 100);
      const wv = dims.visualWidth * (ann.widthPercent / 100);
      const hv = dims.visualHeight * (ann.heightPercent / 100);
      const placement = place(xv, yv);

      if (ann.type === 'rect') {
        const fillColor = ann.fillColor ? hexToRgb(ann.fillColor) : undefined;
        const borderColor = ann.strokeColor ? hexToRgb(ann.strokeColor) : undefined;
        page.drawRectangle({
          x: placement.x,
          y: placement.y,
          width: wv,
          height: hv,
          rotate: degrees(placement.rotateDegrees),
          color: fillColor,
          borderColor,
          borderWidth: ann.strokeWidth,
        });
      } else if (ann.type === 'text') {
        if (ann.backgroundColor) {
          page.drawRectangle({
            x: placement.x,
            y: placement.y,
            width: wv,
            height: hv,
            rotate: degrees(placement.rotateDegrees),
            color: hexToRgb(ann.backgroundColor),
          });
        }
        // Baseline adjustment: In visual coordinates, placement.y is the bottom of the box.
        // We offset by roughly 20% of font size to keep the text inside the bounds.
        const baseline = place(xv, yv + ann.fontSize * 0.15);
        page.drawText(ann.text, {
          x: baseline.x,
          y: baseline.y,
          size: ann.fontSize,
          font,
          color: hexToRgb(ann.color),
          rotate: degrees(placement.rotateDegrees),
        });
      } else if (ann.type === 'image' || ann.type === 'drawing') {
        if (!ann.dataUrl) continue;
        const { bytes, mime } = dataUrlToBytes(ann.dataUrl);
        const embeddedImage = mime.includes('jpeg') || mime.includes('jpg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);

        page.drawImage(embeddedImage, {
          x: placement.x,
          y: placement.y,
          width: wv,
          height: hv,
          rotate: degrees(placement.rotateDegrees),
        });
      }
    }
  }
}
