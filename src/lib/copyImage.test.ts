import { afterEach, expect, it, vi } from 'vitest';
import { copyImage } from './copyImage';
import { canvasToBlob, decodeImage, imageToCanvas } from './image';

vi.mock('./image', () => ({
  canvasToBlob: vi.fn(),
  decodeImage: vi.fn(),
  imageToCanvas: vi.fn(),
}));

class TestClipboardItem {
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('starts the PNG write during the click, before the image is generated', async () => {
  const png = new Blob(['result'], { type: 'image/png' });
  const getImage = vi.fn(async () => png);
  const write = vi.fn(async ([item]: TestClipboardItem[]) => {
    expect(item.data['image/png']).toBeInstanceOf(Promise);
    expect(await item.data['image/png']).toBe(png);
  });
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal('ClipboardItem', TestClipboardItem);

  const result = copyImage(getImage);

  expect(write).toHaveBeenCalledOnce();
  expect(getImage).not.toHaveBeenCalled();
  await expect(result).resolves.toBeNull();
});

it.each(['unavailable', 'denied'])('returns the converted image for manual copying when the clipboard is %s', async (mode) => {
  const write = vi.fn().mockRejectedValue(new Error('Clipboard access denied'));
  vi.stubGlobal('navigator', mode === 'denied' ? { clipboard: { write } } : {});
  vi.stubGlobal('ClipboardItem', TestClipboardItem);

  const image = { naturalWidth: 64, naturalHeight: 32 } as HTMLImageElement;
  const canvas = {} as HTMLCanvasElement;
  const webp = new Blob(['result'], { type: 'image/webp' });
  const png = new Blob(['converted result'], { type: 'image/png' });
  vi.mocked(decodeImage).mockResolvedValue(image);
  vi.mocked(imageToCanvas).mockReturnValue(canvas);
  vi.mocked(canvasToBlob).mockResolvedValue(png);

  await expect(copyImage(() => webp, 'result.webp')).resolves.toBe(png);
  expect(decodeImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'result.webp', type: 'image/webp' }));
  expect(imageToCanvas).toHaveBeenCalledWith(image, 64, 32);
  expect(canvasToBlob).toHaveBeenCalledWith(canvas, 'image/png');
});

it('reports a failed image generation without claiming a copy', async () => {
  const failure = new Error('No image generated');
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('ClipboardItem', TestClipboardItem);

  await expect(copyImage(() => Promise.reject(failure))).rejects.toBe(failure);
});
