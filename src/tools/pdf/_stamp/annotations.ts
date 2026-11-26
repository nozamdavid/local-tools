import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import type { PDFImage, PDFPage } from 'pdf-lib';
import { translate } from '../../../lib/i18n';
import { calcRotatedCenterVisualOrigin, getVisiblePageDims, hexToRgb, mapVisibleToPdf } from './coords';

export function drawSignature(
  page: PDFPage,
  image: PDFImage,
  { xPercent, yPercent, widthPercent }: { xPercent: number; yPercent: number; widthPercent: number },
): void {
  const dims = getVisiblePageDims(page);
  const width = dims.visualWidth * (widthPercent / 100);
  const placement = mapVisibleToPdf({ x: dims.visualWidth * (xPercent / 100), y: dims.visualHeight * (yPercent / 100) }, dims);
  page.drawImage(image, {
    x: placement.x,
    y: placement.y,
    width,
    height: width * (image.height / image.width),
    rotate: degrees(placement.rotateDegrees),
  });
}

export interface WatermarkPosition {
  x: number;
  y: number;
}

interface WatermarkBase {
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
}

export type WatermarkSettings = WatermarkBase &
  ({ type: 'text'; text: string; fontSize: number; color: string } | { type: 'image'; file: File; scale: number });

export type WatermarkDrawer = (page: PDFPage) => void;

const MAX_WATERMARK_IMAGE_DIMENSION = 4096;

async function watermarkImageBytes(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_WATERMARK_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('Could not prepare the watermark image.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** Creates the exact page stamping function used by both preview and export. */
export async function createWatermarkDrawer(pdf: PDFDocument, settings: WatermarkSettings): Promise<WatermarkDrawer> {
  if (settings.type === 'text') {
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    return (page) => {
      const dims = getVisiblePageDims(page);
      const textWidth = font.widthOfTextAtSize(settings.text, settings.fontSize);
      const textHeight = settings.fontSize * 0.7;
      const origin = calcRotatedCenterVisualOrigin(
        dims.visualWidth * settings.position.x,
        dims.visualHeight * settings.position.y,
        textWidth,
        textHeight,
        settings.rotation,
      );
      const placement = mapVisibleToPdf({ ...origin, angle: settings.rotation }, dims);
      page.drawText(settings.text, {
        x: placement.x,
        y: placement.y,
        size: settings.fontSize,
        font,
        color: hexToRgb(settings.color),
        opacity: settings.opacity,
        rotate: degrees(placement.rotateDegrees),
      });
    };
  }

  const imageBytes = await watermarkImageBytes(settings.file);
  const image = await pdf.embedPng(imageBytes);
  return (page) => {
    const dims = getVisiblePageDims(page);
    const width = dims.visualWidth * (settings.scale / 100);
    const height = width * (image.height / image.width);
    const origin = calcRotatedCenterVisualOrigin(
      dims.visualWidth * settings.position.x,
      dims.visualHeight * settings.position.y,
      width,
      height,
      settings.rotation,
    );
    const placement = mapVisibleToPdf({ ...origin, angle: settings.rotation }, dims);
    page.drawImage(image, {
      x: placement.x,
      y: placement.y,
      width,
      height,
      opacity: settings.opacity,
      rotate: degrees(placement.rotateDegrees),
    });
  };
}

export type PageNumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

export interface PageNumberSettings {
  position: PageNumberPosition;
  format: string;
  fontSize: number;
  margin: number;
  color: string;
}

export type PageNumberDrawer = (page: PDFPage, number: number, total: number) => void;

/** Creates the exact page-number stamping function used by both preview and export. */
export async function createPageNumberDrawer(pdf: PDFDocument, settings: PageNumberSettings): Promise<PageNumberDrawer> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  return (page, number, total) => {
    const dims = getVisiblePageDims(page);
    const text = settings.format.replace('{n}', String(number)).replace('{total}', String(total));
    const textWidth = font.widthOfTextAtSize(text, settings.fontSize);
    if (textWidth > dims.visualWidth || settings.fontSize > dims.visualHeight) {
      throw new Error(translate('Page numbers do not fit on this page. Reduce the font size.'));
    }
    let x = settings.margin;
    let y = settings.margin;

    switch (settings.position) {
      case 'bottom-center':
        x = (dims.visualWidth - textWidth) / 2;
        break;
      case 'bottom-right':
        x = dims.visualWidth - settings.margin - textWidth;
        break;
      case 'top-center':
        x = (dims.visualWidth - textWidth) / 2;
        y = dims.visualHeight - settings.margin - settings.fontSize;
        break;
      case 'top-left':
        y = dims.visualHeight - settings.margin - settings.fontSize;
        break;
      case 'top-right':
        x = dims.visualWidth - settings.margin - textWidth;
        y = dims.visualHeight - settings.margin - settings.fontSize;
        break;
      case 'bottom-left':
        break;
    }

    x = Math.max(0, Math.min(dims.visualWidth - textWidth, x));
    y = Math.max(0, Math.min(dims.visualHeight - settings.fontSize, y));
    const placement = mapVisibleToPdf({ x, y }, dims);
    page.drawText(text, {
      x: placement.x,
      y: placement.y,
      size: settings.fontSize,
      font,
      color: hexToRgb(settings.color),
      rotate: degrees(placement.rotateDegrees),
    });
  };
}
