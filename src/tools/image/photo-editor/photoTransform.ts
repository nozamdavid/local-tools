import { getRotationBounds, getRotationCrop, rotationAxes } from '../../../lib/rotationCrop';
import type { CanvasDocument, Layer, RedactLayer } from '../_canvas/types';

type Point = { x: number; y: number };

export function getBaseTransform(doc: CanvasDocument): NonNullable<CanvasDocument['baseTransform']> {
  return doc.baseTransform ?? { width: doc.width, height: doc.height, angle: 0 };
}

function alignSolidMaskToPixelGrid(layer: RedactLayer): RedactLayer {
  const swap = (layer.rotation ?? 0) % 180 !== 0;
  const width = swap ? layer.height : layer.width;
  const height = swap ? layer.width : layer.height;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const left = Math.floor(cx - width / 2);
  const top = Math.floor(cy - height / 2);
  const right = Math.ceil(cx + width / 2);
  const bottom = Math.ceil(cy + height / 2);
  const alignedWidth = swap ? bottom - top : right - left;
  const alignedHeight = swap ? right - left : bottom - top;
  return {
    ...layer,
    x: (left + right - alignedWidth) / 2,
    y: (top + bottom - alignedHeight) / 2,
    width: alignedWidth,
    height: alignedHeight,
  };
}

function transformLayers(layers: Layer[], point: (p: Point) => Point, angle: number, flip?: 'x' | 'y'): Layer[] {
  return layers.map((original) => {
    const layer =
      original.type === 'redact' && original.redactType === 'solid' && original.rotation === undefined
        ? alignSolidMaskToPixelGrid(original)
        : original;
    if (layer.type === 'path') return { ...layer, points: layer.points.map(point) };

    const rotation = layer.rotation ?? 0;
    const { x, y, width, height } = layer;
    const center = point({ x: x + width / 2, y: y + height / 2 });

    return {
      ...layer,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      rotation: Math.round(((flip ? -rotation : rotation + angle) % 360) * 1e8) / 1e8,
      flipX: flip === 'x' ? !layer.flipX : layer.flipX,
      flipY: flip === 'y' ? !layer.flipY : layer.flipY,
    };
  });
}

function reframePhoto(doc: CanvasDocument, width: number, height: number): CanvasDocument {
  const dx = (width - doc.width) / 2;
  const dy = (height - doc.height) / 2;
  if (!dx && !dy) return doc;

  return {
    ...doc,
    width,
    height,
    layers: doc.layers.map((layer) =>
      layer.type === 'path'
        ? { ...layer, points: layer.points.map(({ x, y }) => ({ x: x + dx, y: y + dy })) }
        : { ...layer, x: layer.x + dx, y: layer.y + dy },
    ),
  };
}

export function migrateExpandedPhotoFrame(doc: CanvasDocument): CanvasDocument {
  const base = doc.baseTransform;
  if (!base) return doc;
  const { width, height } = getRotationCrop(base.width, base.height, base.angle);
  if ((width - doc.width) % 2 === 0 && (height - doc.height) % 2 === 0) return reframePhoto(doc, width, height);

  // Legacy axis-aligned masks covered whole pixels in the old frame. Preserve
  // their full coverage when the crop moves the frame by half a pixel.
  const layers = doc.layers.map((layer) =>
    layer.type === 'redact' && layer.redactType === 'solid' && (layer.rotation ?? 0) % 90 === 0
      ? { ...alignSolidMaskToPixelGrid(layer), rotation: layer.rotation ?? 0 }
      : layer,
  );
  return reframePhoto({ ...doc, layers }, width, height);
}

export function rotatePhoto(doc: CanvasDocument, angle: number): CanvasDocument {
  const base = getBaseTransform(doc);
  const delta = (angle - base.angle) % 360;
  if (!delta) return doc;

  const { width, height } = getRotationCrop(base.width, base.height, angle);
  const { cos, sin } = rotationAxes(delta);
  const point = (p: Point) => {
    const x = p.x - doc.width / 2;
    const y = p.y - doc.height / 2;
    return { x: width / 2 + x * cos - y * sin, y: height / 2 + x * sin + y * cos };
  };
  return { ...doc, width, height, baseTransform: { ...base, angle }, layers: transformLayers(doc.layers, point, delta) };
}

export function getPhotoRotationSurround(width: number, height: number, angle: number, kept: { width: number; height: number }) {
  const bounds = getRotationBounds(width, height, angle);
  // An integer offset keeps the preview and output aligned to the same pixel grid.
  return {
    width: kept.width + 2 * Math.ceil((bounds.width - kept.width) / 2),
    height: kept.height + 2 * Math.ceil((bounds.height - kept.height) / 2),
  };
}

export function getPhotoRotationPreview(doc: CanvasDocument, angle = getBaseTransform(doc).angle) {
  const cropped = rotatePhoto(doc, angle);
  const base = getBaseTransform(cropped);
  const surround = getPhotoRotationSurround(base.width, base.height, base.angle, cropped);
  return {
    document: reframePhoto(cropped, surround.width, surround.height),
    frame: {
      x: (surround.width - cropped.width) / 2,
      y: (surround.height - cropped.height) / 2,
      width: cropped.width,
      height: cropped.height,
    },
  };
}

export function flipPhoto(doc: CanvasDocument, horizontal: boolean): CanvasDocument {
  const base = getBaseTransform(doc);
  const point = ({ x, y }: Point) => (horizontal ? { x: doc.width - x, y } : { x, y: doc.height - y });
  const baseTransform = horizontal
    ? { ...base, angle: -base.angle, flipX: !base.flipX }
    : { ...base, angle: -base.angle, flipY: !base.flipY };
  return { ...doc, baseTransform, layers: transformLayers(doc.layers, point, 0, horizontal ? 'x' : 'y') };
}
