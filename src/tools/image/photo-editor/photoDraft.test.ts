import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasToBlob, imageToCanvas, loadImage } from '../../../lib/image';
import { readRecentDraft, writeRecentDraft } from '../../../lib/recentFiles';
import { getRotationBounds } from '../../../lib/rotationCrop';
import type { CanvasDocument, ImageLayer } from '../_canvas/types';
import { restorePhotoDraft, savePhotoDraft } from './photoDraft';
import { flipPhoto, getPhotoRotationPreview, rotatePhoto } from './photoTransform';

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

it('reframes a legacy expanded draft around its cropped raster without shifting content relative to the base', async () => {
  const baseImage = new Blob(['crop pixels'], { type: 'image/png' });
  const croppedRaster = { naturalWidth: 320, naturalHeight: 240 } as HTMLImageElement;
  vi.mocked(loadImage).mockResolvedValue(croppedRaster);
  vi.mocked(readRecentDraft).mockResolvedValue({
    version: 1,
    width: 396,
    height: 396,
    baseImage,
    baseTransform: { width: 320, height: 240, angle: 45, flipX: true },
    layers: [
      { id: 'mask', type: 'redact', redactType: 'solid', x: 180.9, y: 192.9, width: 20, height: 12 },
      { id: 'pen', type: 'path', x: 0, y: 0, width: 0, height: 0, points: [{ x: 190, y: 200 }], stroke: '#000', strokeWidth: 4 },
    ],
  });

  const restored = await restorePhotoDraft(file, original);
  expect(restored).toMatchObject({
    width: 169,
    height: 169,
    baseTransform: { width: 320, height: 240, angle: 45, flipX: true },
    layers: [{ x: 66.5, y: 78.5, width: 21, height: 13 }, { points: [{ x: 76.5, y: 86.5 }] }],
  });
  expect(restored?.baseImage).toBe(croppedRaster);
  if (!restored) throw new Error('Expected a restored draft');

  const resetAfterFlip = rotatePhoto(flipPhoto(restored, true), 0);
  expect(resetAfterFlip).toMatchObject({
    width: 320,
    height: 240,
    baseTransform: { angle: 0, flipX: false },
  });
  expect(resetAfterFlip.baseImage).toBe(croppedRaster);
});

it('keeps the full surround and saved crop aligned for a rotated text layer, path, and solid mask', () => {
  const doc: CanvasDocument = {
    ...originalDoc,
    layers: [
      { id: 'label', type: 'text', text: 'Label', x: 20, y: 24, width: 40, height: 20, fontSize: 16, fontFamily: 'sans', fill: '#000' },
      { id: 'pen', type: 'path', x: 0, y: 0, width: 0, height: 0, points: [{ x: 330, y: 240 }], stroke: '#000', strokeWidth: 4 },
      { id: 'mask', type: 'redact', redactType: 'solid', x: 325, y: 236, width: 10, height: 8 },
    ],
  };
  const rotated = rotatePhoto(doc, 45);
  const { document: surround, frame } = getPhotoRotationPreview(rotated);
  expect(rotated).toMatchObject({ width: 339, height: 339 });
  expect(surround).toMatchObject({ width: 793, height: 793, baseTransform: rotated.baseTransform });
  expect(surround.baseImage).toBe(original);
  expect(frame).toEqual({ x: 227, y: 227, width: 339, height: 339 });
  expect(rotated.layers[0].y).toBeLessThan(0);
  expect(surround.layers[0]).toMatchObject({ x: rotated.layers[0].x + frame.x, y: rotated.layers[0].y + frame.y, rotation: 45 });

  const mark = 169.5 + 10 / Math.sqrt(2);
  expect(rotated.layers[1]).toMatchObject({ points: [{ x: mark, y: mark }] });
  expect(rotated.layers[2]).toMatchObject({ x: mark - 5, y: mark - 4, width: 10, height: 8, rotation: 45 });
  expect(surround.layers[2]).toMatchObject({ x: mark - 5 + frame.x, y: mark - 4 + frame.y, width: 10, height: 8, rotation: 45 });

  const quarter = rotatePhoto(doc, 90);
  expect(quarter).toMatchObject({ width: 480, height: 640 });
  expect(quarter.layers[1]).toMatchObject({ points: [{ x: 240, y: 330 }] });
  expect(quarter.layers[2]).toMatchObject({ rotation: 90 });

  const reset = rotatePhoto(rotatePhoto(rotated, -19.2), 0);
  expect(reset).toMatchObject({ width: 640, height: 480, baseTransform: { angle: 0 } });
  expect(reset.baseImage).toBe(original);
  for (const [index, layer] of reset.layers.entries()) {
    expect(layer.x).toBeCloseTo(doc.layers[index].x, 8);
    expect(layer.y).toBeCloseTo(doc.layers[index].y, 8);
    expect(layer.rotation ?? 0).toBe(0);
  }
  const path = reset.layers[1];
  if (path.type !== 'path') throw new Error('Expected path layer');
  expect(path.points[0].x).toBeCloseTo(330, 8);
  expect(path.points[0].y).toBeCloseTo(240, 8);
  expect(getPhotoRotationPreview(doc, 45)).toEqual({ document: surround, frame });
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

it.each(['blur', 'pixelate'] as const)('keeps a %s mask the same size when the photo is straightened and restored', (redactType) => {
  const mask = { id: 'mask', type: 'redact', redactType, x: 180, y: 170, width: 80, height: 30 } as const;
  const doc = { ...originalDoc, layers: [mask] };
  const rotated = rotatePhoto(doc, 22);
  expect(rotated.layers[0]).toMatchObject({ width: mask.width, height: mask.height, rotation: 22 });
  const [restored] = rotatePhoto(rotatePhoto(rotated, -17), 0).layers;
  expect(restored).toMatchObject({ width: mask.width, height: mask.height, rotation: 0 });
  expect(restored.x).toBeCloseTo(mask.x);
  expect(restored.y).toBeCloseTo(mask.y);
});

it('contains the full rotated source without adding pixels at exact right angles', () => {
  // At one degree the exact bounds are approximately 100.334 × 21.742.
  expect(getRotationBounds(100, 20, 1)).toEqual({ width: 101, height: 22 });
  expect(getRotationBounds(100, 20, 90)).toEqual({ width: 20, height: 100 });
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
