import { describe, expect, it } from 'vitest';
import { createCropSelection, moveCrop, resizeCrop, updateCropValue } from './geometry';

describe('crop geometry', () => {
  it('creates a fixed-ratio selection inside the source image even when drawn past its edge', () => {
    const crop = createCropSelection({ x: 90, y: 70 }, { x: 120, y: 85 }, { width: 100, height: 80 }, 2);

    expect(crop).toEqual({ x: 90, y: 70, width: 10, height: 5 });
    expect(crop.x + crop.width).toBeLessThanOrEqual(100);
    expect(crop.y + crop.height).toBeLessThanOrEqual(80);
    expect(crop.width / crop.height).toBe(2);
  });

  it('keeps movement and corner resizing within bounds while preserving a fixed ratio', () => {
    const bounds = { width: 120, height: 80 };
    const moved = moveCrop({ x: 20, y: 15, width: 60, height: 40 }, 80, 50, bounds);
    const resized = resizeCrop(moved, 50, 30, 'se', bounds, 1.5);

    expect(moved).toEqual({ x: 60, y: 40, width: 60, height: 40 });
    expect(resized.x + resized.width).toBeLessThanOrEqual(bounds.width);
    expect(resized.y + resized.height).toBeLessThanOrEqual(bounds.height);
    expect(resized.width / resized.height).toBeCloseTo(1.5, 1);
  });

  it('synchronizes numeric width changes with the selected aspect ratio', () => {
    expect(updateCropValue({ x: 10, y: 10, width: 40, height: 30 }, 'width', 60, { width: 100, height: 100 }, 2)).toEqual({
      x: 10,
      y: 10,
      width: 60,
      height: 30,
    });
  });
});
