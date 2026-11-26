import { afterEach, expect, it, vi } from 'vitest';
import { drawWithImageFilters } from './canvasFilters';

afterEach(() => vi.unstubAllGlobals());

function filterWithoutCanvasSupport(width: number, height: number, pixels: Uint8ClampedArray) {
  const image = { data: pixels };
  const scratch = {
    translate: vi.fn(),
    getImageData: vi.fn((_: number, __: number, width: number, height: number) => ({ ...image, width, height })),
    putImageData: vi.fn(),
  };
  const ctx = { canvas: { width, height }, drawImage: vi.fn() };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => scratch }) });
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    scratch,
  };
}

it('applies color adjustments in order and preserves alpha without canvas.filter', () => {
  const pixels = new Uint8ClampedArray([200, 80, 40, 128]);
  const { ctx, scratch } = filterWithoutCanvasSupport(1, 1, pixels);

  drawWithImageFilters(ctx, vi.fn(), {
    colors: [
      ['brightness', 200],
      ['saturate', 0],
    ],
  });

  expect([...pixels]).toEqual([174, 174, 174, 128]);
  expect(scratch.putImageData).toHaveBeenCalledOnce();
});

it('blurs a region with neighboring pixels and filters alpha in premultiplied space', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  pixels.set([255, 0, 0, 255], 4 * (2 * 5 + 1));
  pixels.set([0, 255, 0, 0], 4 * (2 * 5 + 2));
  const { ctx, scratch } = filterWithoutCanvasSupport(8, 8, pixels);
  const draw = vi.fn();

  drawWithImageFilters(ctx, draw, { blur: 1, bounds: { x: 3, y: 4, width: 1, height: 1 } });

  expect(scratch.translate).toHaveBeenCalledWith(-1, -2);
  expect(draw).toHaveBeenCalledWith(scratch);
  expect([...pixels.slice(4 * 12, 4 * 13)]).toEqual([255, 0, 0, 19]);
  expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 2, 2, 1, 1, 3, 4, 1, 1);
});
