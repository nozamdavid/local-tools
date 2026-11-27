import { expect, it, vi } from 'vitest';
import { drawFrame, getFrameSize, type FrameSettings } from './render';

const fullFrame: FrameSettings = { angle: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };

it('caps both orientations while preserving a large 16:9 crop', () => {
  const crop = { ...fullFrame, crop: { x: 0, y: 0.125, width: 1, height: 0.75 } };
  expect(getFrameSize(8000, 6000, crop)).toEqual({ width: 3840, height: 2160 });
  expect(getFrameSize(8000, 6000, { ...crop, angle: 90, crop: { x: 0.125, y: 0, width: 0.75, height: 1 } })).toEqual({
    width: 2160,
    height: 3840,
  });
  expect(getFrameSize(1, 1, fullFrame)).toEqual({ width: 2, height: 2 });
});

it('draws an offset crop inside the rotation and center covers a wider photo', () => {
  const ctx = {
    save: vi.fn(),
    resetTransform: vi.fn(),
    fillRect: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
  };
  const canvas = { width: 35, height: 70, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const source = {} as HTMLImageElement;
  const settings = { angle: 45, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
  expect(getFrameSize(200, 200, settings)).toEqual({ width: 70, height: 142 });
  drawFrame(canvas, source, 300, 150, 200, 200, settings);

  expect(ctx.scale).toHaveBeenCalledWith(35 / 70.5, 70 / 141);
  expect(ctx.translate).toHaveBeenCalledWith(-0, 70.5);
  const [cos, sin] = ctx.transform.mock.calls[0] as [number, number];
  for (const x of [0, 70.5]) {
    for (const y of [-70.5, 70.5]) {
      expect(Math.abs(cos * x + sin * y)).toBeLessThan(100);
      expect(Math.abs(-sin * x + cos * y)).toBeLessThan(100);
    }
  }
  expect(ctx.drawImage).toHaveBeenCalledWith(source, -200, -100, 400, 200);
  expect(ctx.restore).toHaveBeenCalledOnce();
});
