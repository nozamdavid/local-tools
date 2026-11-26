import { describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { createPageNumberDrawer, createWatermarkDrawer, drawSignature } from './annotations';
import { getVisiblePageDims, mapVisibleToPdf } from './coords';

function addVisiblePage(doc: PDFDocument, rotation: number) {
  const page = doc.addPage([640, 800]);
  page.setMediaBox(20, 30, 640, 800);
  page.setCropBox(50, 100, 400, 600);
  page.setRotation(degrees(rotation));
  return page;
}

describe('PDF stamp preview and export placement', () => {
  it.each([
    [0, 60, 120, 45],
    [90, 430, 110, 135],
    [180, 440, 680, 225],
    [270, 70, 690, 315],
  ])('maps visible coordinates with the CropBox origin at rotation %i', async (rotation, x, y, angle) => {
    const doc = await PDFDocument.create();
    const page = addVisiblePage(doc, rotation);
    const dims = getVisiblePageDims(page);

    expect(dims).toMatchObject({
      originX: 50,
      originY: 100,
      visualWidth: rotation === 90 || rotation === 270 ? 600 : 400,
      visualHeight: rotation === 90 || rotation === 270 ? 400 : 600,
    });
    expect(mapVisibleToPdf({ x: 10, y: 20, angle: 45 }, dims)).toEqual({
      x,
      y,
      rotateDegrees: angle,
    });
  });

  it('draws a page number at the visible bottom-left on a rotated, offset page', async () => {
    const doc = await PDFDocument.create();
    const page = addVisiblePage(doc, 90);
    const drawText = vi.spyOn(page, 'drawText');
    const drawNumber = await createPageNumberDrawer(doc, {
      position: 'bottom-left',
      format: 'Page {n} of {total}',
      fontSize: 12,
      margin: 30,
      color: '#000000',
    });

    drawNumber(page, 8, 10);

    expect(drawText).toHaveBeenCalledWith(
      'Page 8 of 10',
      expect.objectContaining({
        x: 420,
        y: 130,
        rotate: degrees(90),
      }),
    );
  });

  it('draws the signature inside the visible area of a rotated, offset page', async () => {
    const doc = await PDFDocument.create();
    const page = addVisiblePage(doc, 90);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/l8AAAAASUVORK5CYII=';
    const image = await doc.embedPng(png);
    const drawImage = vi.spyOn(page, 'drawImage');

    drawSignature(page, image, { xPercent: 25, yPercent: 20, widthPercent: 10 });

    expect(drawImage).toHaveBeenCalledWith(image, { x: 370, y: 250, width: 60, height: 60, rotate: degrees(90) });
  });

  it('uses the same watermark position and rotation for preview and export', async () => {
    const settings = {
      type: 'text' as const,
      text: 'DRAFT',
      fontSize: 24,
      color: '#888888',
      opacity: 0.35,
      rotation: 30,
      position: { x: 0.25, y: 0.75 },
    };

    const stampOnce = async () => {
      const doc = await PDFDocument.create();
      const page = addVisiblePage(doc, 90);
      const drawText = vi.spyOn(page, 'drawText');
      const drawWatermark = await createWatermarkDrawer(doc, settings);
      drawWatermark(page);
      const options = drawText.mock.calls[0][1];
      if (!options) throw new Error('Expected watermark drawing options.');
      return { x: options.x, y: options.y, rotate: options.rotate };
    };

    const previewPlacement = await stampOnce();
    const exportPlacement = await stampOnce();
    const metricDoc = await PDFDocument.create();
    const metricFont = await metricDoc.embedFont(StandardFonts.HelveticaBold);
    const width = metricFont.widthOfTextAtSize(settings.text, settings.fontSize);
    const halfWidth = width / 2;
    const halfHeight = (settings.fontSize * 0.7) / 2;
    const radians = (settings.rotation * Math.PI) / 180;

    expect(previewPlacement).toEqual(exportPlacement);
    expect(previewPlacement.x).toBeCloseTo(150 + halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians));
    expect(previewPlacement.y).toBeCloseTo(250 - halfWidth * Math.cos(radians) + halfHeight * Math.sin(radians));
    expect(previewPlacement.rotate).toEqual(degrees(120));
  });
});
