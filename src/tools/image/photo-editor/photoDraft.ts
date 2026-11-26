import { canvasToBlob, imageToCanvas, loadImage } from '../../../lib/image';
import { readRecentDraft, writeRecentDraft } from '../../../lib/recentFiles';
import type { CanvasDocument, ImageLayer, Layer } from '../_canvas/types';

const toolPath = '/image/photo-editor';
type Raster = HTMLImageElement | HTMLCanvasElement;
type SavedLayer = Exclude<Layer, ImageLayer> | (Omit<ImageLayer, 'image'> & { image: Blob });
type PhotoDraft = Omit<CanvasDocument, 'baseImage' | 'layers'> & { version: 1; baseImage: Blob | null; layers: SavedLayer[] };

// The editor creates a new base canvas for each crop or transform. Reuse its
// encoded pixels while subsequent edits change only the layers or adjustments.
const savedRasters = new WeakMap<Raster, Promise<Blob>>();
function encodeRaster(image: Raster): Promise<Blob> {
  const cached = savedRasters.get(image);
  if (cached) return cached;
  const canvas = image instanceof HTMLCanvasElement ? image : imageToCanvas(image, image.naturalWidth, image.naturalHeight);
  const encoded = canvasToBlob(canvas, 'image/png').catch((error: unknown) => {
    savedRasters.delete(image);
    throw error;
  });
  savedRasters.set(image, encoded);
  return encoded;
}

async function restoreRaster(blob: Blob): Promise<HTMLImageElement> {
  const image = await loadImage(blob);
  savedRasters.set(image, Promise.resolve(blob));
  return image;
}

const latestSave = new WeakMap<File, symbol>();
export async function savePhotoDraft(file: File, doc: CanvasDocument, original: HTMLImageElement): Promise<boolean> {
  const ticket = Symbol();
  latestSave.set(file, ticket);
  try {
    const baseImage = doc.baseImage && doc.baseImage !== original ? await encodeRaster(doc.baseImage) : null;
    const layers: SavedLayer[] = await Promise.all(
      doc.layers.map(async (layer) => (layer.type === 'image' ? { ...layer, image: await encodeRaster(layer.image) } : layer)),
    );
    if (latestSave.get(file) !== ticket) return true;
    const draft: PhotoDraft = { ...doc, version: 1, baseImage, layers };
    const extraBytes = layers.reduce((sum, layer) => sum + (layer.type === 'image' ? layer.image.size : 0), baseImage?.size ?? 0);
    return await writeRecentDraft(file, toolPath, draft, extraBytes + new Blob([JSON.stringify(draft)]).size);
  } catch {
    return false;
  }
}

export async function restorePhotoDraft(file: File, original: HTMLImageElement): Promise<CanvasDocument | null> {
  const draft = await readRecentDraft<PhotoDraft>(file, toolPath);
  if (!draft || draft.version !== 1 || !Array.isArray(draft.layers)) return null;
  try {
    const baseImage = draft.baseImage ? await restoreRaster(draft.baseImage) : original;
    const layers: Layer[] = await Promise.all(
      draft.layers.map(async (layer) => (layer.type === 'image' ? { ...layer, image: await restoreRaster(layer.image) } : layer)),
    );
    return {
      width: draft.width,
      height: draft.height,
      adjustments: draft.adjustments,
      backgroundColor: draft.backgroundColor,
      baseImage,
      layers,
    };
  } catch {
    return null;
  }
}
