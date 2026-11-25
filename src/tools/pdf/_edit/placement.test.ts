import { describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import { applyAnnotations } from './annotate';
import { fitAnnotationBox } from './placement';

describe('annotation placement', () => {
  it.each([
    [0, 130, 280, 100, 60],
    [90, 330, 220, 150, 40],
    [180, 370, 520, 100, 60],
    [270, 170, 580, 150, 40],
  ])('exports within the visible CropBox at rotation %i', async (rotation, x, y, width, height) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(50, 100, 400, 600);
    page.setRotation(degrees(rotation));
    const draw = vi.spyOn(page, 'drawRectangle');

    await applyAnnotations(doc, [
      {
        id: 'rect',
        type: 'rect',
        pageNum: 1,
        xPercent: 20,
        yPercent: 30,
        widthPercent: 25,
        heightPercent: 10,
        strokeColor: '#000000',
        strokeWidth: 1,
      },
    ]);

    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        x,
        y,
        width,
        height,
        rotate: degrees(rotation),
      }),
    );
    expect(page.getCropBox()).toEqual({ x: 50, y: 100, width: 400, height: 600 });
    expect(page.getRotation().angle).toBe(rotation);
  });

  it('intersects a crop outside the media bounds, including a nonzero media origin', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setMediaBox(20, 30, 600, 800);
    page.setCropBox(0, 0, 400, 500);
    const draw = vi.spyOn(page, 'drawRectangle');
    await applyAnnotations(doc, [
      {
        id: 'rect',
        type: 'rect',
        pageNum: 1,
        xPercent: 0,
        yPercent: 0,
        widthPercent: 100,
        heightPercent: 100,
        strokeColor: '#000000',
        strokeWidth: 1,
      },
    ]);
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ x: 20, y: 30, width: 380, height: 470 }));
  });

  it('maps the text baseline offset in visual coordinates on rotated pages', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(50, 100, 400, 600);
    page.setRotation(degrees(90));
    const draw = vi.spyOn(page, 'drawText');
    await applyAnnotations(doc, [
      {
        id: 'text',
        type: 'text',
        pageNum: 1,
        text: 'Hello',
        fontSize: 20,
        color: '#000000',
        xPercent: 20,
        yPercent: 30,
        widthPercent: 25,
        heightPercent: 10,
      },
    ]);
    expect(draw).toHaveBeenCalledWith('Hello', expect.objectContaining({ x: 327, y: 220 }));
  });

  it('keeps rectangles inside the top and right edges', () => {
    expect(fitAnnotationBox(100, 100, 30, 15)).toEqual({
      xPercent: 70,
      yPercent: 85,
      widthPercent: 30,
      heightPercent: 15,
    });
    expect(fitAnnotationBox(-10, -10, 30, 15)).toMatchObject({ xPercent: 0, yPercent: 0 });
  });

  it('fits a tall image without distorting its proportions', () => {
    expect(fitAnnotationBox(90, 90, 40, 200)).toEqual({
      xPercent: 80,
      yPercent: 0,
      widthPercent: 20,
      heightPercent: 100,
    });
  });
});
