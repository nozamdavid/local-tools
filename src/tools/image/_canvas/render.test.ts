import { expect, it, vi } from 'vitest';
import { canvasToBlob } from '../../../lib/image';
import { exportDocument } from './render';

vi.mock('../../../lib/image', () => ({ canvasToBlob: vi.fn() }));

it('clips an off-canvas pixelation layer to the visible portion and replaces the original pixels', async () => {
  const sample = { drawImage: vi.fn() };
  const maskCanvas = { width: 0, height: 0, getContext: () => sample };
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    globalCompositeOperation: 'source-over',
    drawImage: vi.fn(function (this: { globalCompositeOperation: string }) {
      expect(this.globalCompositeOperation).toBe('copy');
    }),
  };
  const canvas = { width: 0, height: 0, getContext: () => ({ ...ctx, canvas }) };
  const createElement = vi.fn().mockReturnValueOnce(canvas).mockReturnValueOnce(maskCanvas);
  vi.stubGlobal('document', { createElement });
  const png = new Blob(['encoded'], { type: 'image/png' });
  vi.mocked(canvasToBlob).mockResolvedValueOnce(png);

  try {
    await expect(
      exportDocument(
        {
          width: 100,
          height: 100,
          baseImage: null,
          layers: [{ id: 'mask', type: 'redact', redactType: 'pixelate', x: -5, y: 2, width: 10, height: 10 }],
        },
        'image/png',
      ),
    ).resolves.toBe(png);

    expect(sample.drawImage).toHaveBeenCalledWith(canvas, 0, 2, 5, 10, 0, 0, 1, 2);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledWith(maskCanvas, 0, 2, 5, 10);
  } finally {
    vi.unstubAllGlobals();
  }
});
