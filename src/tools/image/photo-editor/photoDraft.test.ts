import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasToBlob, imageToCanvas, loadImage } from '../../../lib/image';
import { readRecentDraft, writeRecentDraft } from '../../../lib/recentFiles';
import type { CanvasDocument, ImageLayer } from '../_canvas/types';
import { restorePhotoDraft, savePhotoDraft } from './photoDraft';
import { rotatePhoto } from './photoTransform';

vi.mock('../../../lib/image', () => ({ canvasToBlob: vi.fn(), imageToCanvas: vi.fn(), loadImage: vi.fn() }));
vi.mock('../../../lib/recentFiles', () => ({ readRecentDraft: vi.fn(), writeRecentDraft: vi.fn() }));

class TestCanvas {}

const file = new File(['source'], 'photo.jpg', { type: 'image/jpeg' });
const original = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
const originalDoc: CanvasDocument = { width: 640, height: 480, baseImage: original, layers: [] };

beforeEach(() => {
  vi.stubGlobal('HTMLCanvasElement', TestCanvas);
  vi.mocked(writeRecentDraft).mockImplementation(async (_file, _toolPath, draft) => {
    vi.mocked(readRecentDraft).mockResolvedValue(draft);
    return true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('restores an unchanged base using the supplied original without encoding or decoding it', async () => {
  await expect(savePhotoDraft(file, originalDoc, original)).resolves.toBe(true);

  const reopenedOriginal = { ...original };
  const restored = await restorePhotoDraft(file, reopenedOriginal);

  expect(restored?.baseImage).toBe(reopenedOriginal);
  expect(canvasToBlob).not.toHaveBeenCalled();
  expect(imageToCanvas).not.toHaveBeenCalled();
  expect(loadImage).not.toHaveBeenCalled();
});

it('persists an exact rotation and its moved solid mask while reusing the original raster', async () => {
  const rotated = rotatePhoto(
    {
      ...originalDoc,
      layers: [{ id: 'mask', type: 'redact', redactType: 'solid', x: 11, y: 24, width: 80, height: 40 }],
    },
    17.3,
  );

  await expect(savePhotoDraft(file, rotated, original)).resolves.toBe(true);
  expect(rotated.baseTransform).toEqual({ angle: 17.3, width: 640, height: 480 });
  expect(rotated.layers[0]).toMatchObject({ rotation: 17.3, redactType: 'solid', width: 80, height: 40 });
  expect(canvasToBlob).not.toHaveBeenCalled();

  const reopenedOriginal = { ...original };
  const reopened = await restorePhotoDraft(file, reopenedOriginal);
  expect(reopened).toEqual({ ...rotated, baseImage: reopenedOriginal });
  expect(reopened?.baseImage).toBe(reopenedOriginal);
});

it('round trips the cropped base, pasted image and other edits', async () => {
  const cropped = new TestCanvas() as HTMLCanvasElement;
  const pasted = { naturalWidth: 64, naturalHeight: 32 } as HTMLImageElement;
  const pastedCanvas = new TestCanvas() as HTMLCanvasElement;
  const croppedPng = new Blob(['crop pixels'], { type: 'image/png' });
  const pastedPng = new Blob(['pasted pixels'], { type: 'image/png' });
  const decodedCrop = { naturalWidth: 320, naturalHeight: 240 } as HTMLImageElement;
  const decodedPaste = { ...pasted };
  const imageLayer: ImageLayer = { id: 'paste', type: 'image', image: pasted, x: 20, y: 12, width: 48, height: 24, rotation: 30 };
  const edited: CanvasDocument = {
    width: 320,
    height: 240,
    baseImage: cropped,
    backgroundColor: '#f0f0f0',
    adjustments: { brightness: 120, contrast: 90, saturation: 70, blur: 2 },
    layers: [imageLayer, { id: 'frame', type: 'rect', x: 10, y: 8, width: 100, height: 60, stroke: '#123456', strokeWidth: 2 }],
  };

  vi.mocked(imageToCanvas).mockReturnValue(pastedCanvas);
  vi.mocked(canvasToBlob).mockImplementation(async (canvas) => (canvas === cropped ? croppedPng : pastedPng));
  vi.mocked(loadImage).mockImplementation(async (blob) => (blob === croppedPng ? decodedCrop : decodedPaste));

  await expect(savePhotoDraft(file, edited, original)).resolves.toBe(true);
  const restored = await restorePhotoDraft(file, original);

  expect(imageToCanvas).toHaveBeenCalledWith(pasted, 64, 32);
  expect(canvasToBlob).toHaveBeenCalledWith(cropped, 'image/png');
  expect(canvasToBlob).toHaveBeenCalledWith(pastedCanvas, 'image/png');
  expect(loadImage).toHaveBeenCalledWith(croppedPng);
  expect(loadImage).toHaveBeenCalledWith(pastedPng);
  expect(restored).toEqual({ ...edited, baseImage: decodedCrop, layers: [{ ...imageLayer, image: decodedPaste }, edited.layers[1]] });
  expect(restored?.baseImage).toBe(decodedCrop);
  const restoredPaste = restored?.layers[0];
  expect(restoredPaste?.type === 'image' && restoredPaste.image).toBe(decodedPaste);
});

it('keeps the newer edit when an older raster finishes encoding after it was saved', async () => {
  const cropped = new TestCanvas() as HTMLCanvasElement;
  let finishEncode!: (blob: Blob) => void;
  const pendingEncode = new Promise<Blob>((resolve) => {
    finishEncode = resolve;
  });
  vi.mocked(canvasToBlob).mockReturnValueOnce(pendingEncode);

  const olderSave = savePhotoDraft(file, { ...originalDoc, width: 320, baseImage: cropped }, original);
  expect(canvasToBlob).toHaveBeenCalledWith(cropped, 'image/png');

  const newerEdit = { ...originalDoc, backgroundColor: '#123456' };
  await expect(savePhotoDraft(file, newerEdit, original)).resolves.toBe(true);
  finishEncode(new Blob(['old crop'], { type: 'image/png' }));
  await olderSave;

  expect(writeRecentDraft).toHaveBeenCalledOnce();
  await expect(restorePhotoDraft(file, original)).resolves.toEqual(newerEdit);
});
