import { describe, expect, it } from 'vitest';
import {
  createDestinationToSourceHomography,
  getPerspectiveOutputSize,
  mapHomography,
  validatePerspectiveCorners,
  warpPerspective,
  type PerspectiveCorners,
} from './perspective';

describe('scanner perspective correction', () => {
  it('preserves pixels for an identity correction', () => {
    const source = new Uint8ClampedArray([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255, 130, 140, 150, 255, 160, 170, 180, 255,
    ]);
    const corners: PerspectiveCorners = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];

    const result = warpPerspective(source, 3, 2, corners);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(Array.from(result.data)).toEqual(Array.from(source));
  });

  it('maps a non-axis-aligned quad to a rectified output', () => {
    const corners: PerspectiveCorners = [
      { x: 1, y: 0 },
      { x: 5, y: 1 },
      { x: 4, y: 5 },
      { x: 0, y: 4 },
    ];
    const size = getPerspectiveOutputSize(corners);
    const transform = createDestinationToSourceHomography(size.width, size.height, corners);
    const mapped = [
      mapHomography(transform, 0, 0),
      mapHomography(transform, size.width, 0),
      mapHomography(transform, size.width, size.height),
      mapHomography(transform, 0, size.height),
    ];
    const source = new Uint8ClampedArray(6 * 6 * 4);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const index = (y * 6 + x) * 4;
        source[index] = x * 30 + y * 5;
        source[index + 3] = 255;
      }
    }
    const result = warpPerspective(source, 6, 6, corners);

    mapped.forEach((point, index) => {
      expect(point.x).toBeCloseTo(corners[index].x, 8);
      expect(point.y).toBeCloseTo(corners[index].y, 8);
    });
    expect(size.width).toBe(size.height);
    expect(result.width).toBe(size.width);
    expect(result.height).toBe(size.height);
    const outputRedValues = new Set<number>();
    for (let index = 0; index < result.data.length; index += 4) outputRedValues.add(result.data[index]);
    expect(outputRedValues.size).toBeGreaterThan(1);
  });

  it('rejects degenerate, crossing, and out-of-bounds corners', () => {
    const degenerate: PerspectiveCorners = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 5, y: 1 },
      { x: 0, y: 1 },
    ];
    const crossing: PerspectiveCorners = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 5, y: 0 },
      { x: 0, y: 5 },
    ];
    const outside: PerspectiveCorners = [
      { x: -1, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];

    expect(() => validatePerspectiveCorners(degenerate, 6, 6)).toThrow(/nondegenerate convex/);
    expect(() => validatePerspectiveCorners(crossing, 6, 6)).toThrow(/nondegenerate convex/);
    expect(() => validatePerspectiveCorners(outside, 6, 6)).toThrow(/inside the image/);
  });

  it('caps the output side while keeping the estimated aspect ratio', () => {
    const corners: PerspectiveCorners = [
      { x: 0, y: 0 },
      { x: 2400, y: 2390 },
      { x: 2393, y: 2400 },
      { x: 0, y: 10 },
    ];
    const size = getPerspectiveOutputSize(corners);
    const width = (Math.hypot(2400, 2390) + Math.hypot(2393, 2390)) / 2;
    const height = (Math.hypot(0, 10) + Math.hypot(7, 10)) / 2;

    expect(size.width).toBe(2400);
    expect(size.height).toBe(Math.round((2400 * height) / width));
    expect(Math.abs(size.width / size.height / (width / height) - 1)).toBeLessThan(0.05);
    expect(() => validatePerspectiveCorners(corners, 2401, 2400)).toThrow(/dimensions/);
  });
});
