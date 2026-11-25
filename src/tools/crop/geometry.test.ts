import { describe, expect, it } from 'vitest';
import { centeredCrop, drawCrop, moveCrop, normalizeCrop, resizeCrop, type CropRect, type SourceBounds } from './geometry';

const bounds: SourceBounds = { width: 641, height: 481 };

function expectEvenAndInBounds(crop: CropRect) {
  expect(crop.x % 2).toBe(0);
  expect(crop.y % 2).toBe(0);
  expect(crop.w % 2).toBe(0);
  expect(crop.h % 2).toBe(0);
  expect(crop.x).toBeGreaterThanOrEqual(0);
  expect(crop.y).toBeGreaterThanOrEqual(0);
  expect(crop.x + crop.w).toBeLessThanOrEqual(bounds.width);
  expect(crop.y + crop.h).toBeLessThanOrEqual(bounds.height);
}

describe('video crop geometry', () => {
  it('keeps a full-frame crop at zero when moving or normalizing offsets', () => {
    const full = centeredCrop(bounds, null);
    expect(moveCrop(full, 100, 100, bounds)).toEqual(full);
    expect(normalizeCrop({ ...full, x: 10, y: 10 }, bounds)).toEqual(full);
  });

  it('rejects sources too small for an even-pixel crop', () => {
    expect(() => centeredCrop({ width: 1, height: 20 }, null)).toThrow();
    expect(() => normalizeCrop({ x: 0, y: 0, w: 2, h: 2 }, { width: 20, height: 1 })).toThrow();
  });

  it('starts with the largest centered even crop for a requested ratio', () => {
    const crop = centeredCrop(bounds, 1);
    expect(crop).toEqual({ x: 80, y: 0, w: 480, h: 480 });
    expectEvenAndInBounds(crop);
  });

  it('draws a new rectangle in either drag direction while preserving the ratio', () => {
    const crop = drawCrop(400, 300, 40, 80, bounds, 16 / 9);
    expectEvenAndInBounds(crop);
    expect(Math.abs(crop.w / crop.h - 16 / 9)).toBeLessThan(0.02);
  });

  it('moves without changing dimensions and clamps at the source bounds', () => {
    const start = { x: 120, y: 80, w: 320, h: 240 };
    const crop = moveCrop(start, 1000, 1000, bounds);
    expect(crop).toEqual({ x: 320, y: 240, w: 320, h: 240 });
    expectEvenAndInBounds(crop);
  });

  it('resizes all sides and corners with even output pixels and source bounds', () => {
    const start = { x: 120, y: 80, w: 320, h: 240 };
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const crop = resizeCrop(start, handle, 12, 10, bounds, 4 / 3);
      expectEvenAndInBounds(crop);
      expect(Math.abs(crop.w / crop.h - 4 / 3)).toBeLessThan(0.02);
    }
  });

  it('normalizes numeric coordinates without shrinking a crop dragged beyond the edge', () => {
    const crop = normalizeCrop({ x: 900, y: 900, w: 200, h: 100 }, bounds);
    expect(crop).toEqual({ x: 440, y: 380, w: 200, h: 100 });
    expectEvenAndInBounds(crop);
  });

  it('clamps aggressive handle movement to the source frame', () => {
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const crop = resizeCrop({ x: 120, y: 80, w: 320, h: 240 }, handle, 900, 900, bounds, null);
      expectEvenAndInBounds(crop);
    }
  });
});
