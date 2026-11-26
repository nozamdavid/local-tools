import type { CanvasDocument, Layer } from '../_canvas/types';

type Point = { x: number; y: number };

export function getBaseTransform(doc: CanvasDocument): NonNullable<CanvasDocument['baseTransform']> {
  return doc.baseTransform ?? { width: doc.width, height: doc.height, angle: 0 };
}

function rotationAxes(angle: number) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return angle % 90 === 0 ? { cos: Math.round(cos), sin: Math.round(sin) } : { cos, sin };
}

export function rotatedSize(width: number, height: number, angle: number) {
  const { cos, sin } = rotationAxes(angle);
  return {
    width: Math.ceil(width * Math.abs(cos) + height * Math.abs(sin)),
    height: Math.ceil(width * Math.abs(sin) + height * Math.abs(cos)),
  };
}

function transformLayers(layers: Layer[], point: (p: Point) => Point, angle: number, flip?: 'x' | 'y'): Layer[] {
  return layers.map((layer) => {
    if (layer.type === 'path') return { ...layer, points: layer.points.map(point) };

    // The axis-aligned renderer previously rounded solid masks out to whole pixels.
    // Preserve their original coverage when moving them into a rotated frame.
    const rotation = layer.rotation ?? 0;
    const roundMask = layer.type === 'redact' && layer.redactType === 'solid' && layer.rotation === undefined;
    const x = roundMask ? Math.floor(layer.x) : layer.x;
    const y = roundMask ? Math.floor(layer.y) : layer.y;
    const width = roundMask ? Math.ceil(layer.x + layer.width) - x : layer.width;
    const height = roundMask ? Math.ceil(layer.y + layer.height) - y : layer.height;
    const center = point({ x: x + width / 2, y: y + height / 2 });

    if (layer.type === 'redact' && layer.redactType !== 'solid') {
      const bounds = rotatedSize(width, height, angle);
      return { ...layer, ...bounds, x: center.x - bounds.width / 2, y: center.y - bounds.height / 2 };
    }

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

export function rotatePhoto(doc: CanvasDocument, angle: number): CanvasDocument {
  const base = getBaseTransform(doc);
  const delta = Math.round((angle - base.angle) * 10) / 10;
  if (!delta || Math.abs(delta) === 360) return doc;

  const size = rotatedSize(base.width, base.height, angle);
  const { cos, sin } = rotationAxes(delta);
  const point = (p: Point) => {
    const x = p.x - doc.width / 2;
    const y = p.y - doc.height / 2;
    return { x: size.width / 2 + x * cos - y * sin, y: size.height / 2 + x * sin + y * cos };
  };
  return { ...doc, ...size, baseTransform: { ...base, angle }, layers: transformLayers(doc.layers, point, delta) };
}

export function flipPhoto(doc: CanvasDocument, horizontal: boolean): CanvasDocument {
  const base = getBaseTransform(doc);
  const point = ({ x, y }: Point) => (horizontal ? { x: doc.width - x, y } : { x, y: doc.height - y });
  const baseTransform = horizontal
    ? { ...base, angle: -base.angle, flipX: !base.flipX }
    : { ...base, angle: -base.angle, flipY: !base.flipY };
  return { ...doc, baseTransform, layers: transformLayers(doc.layers, point, 0, horizontal ? 'x' : 'y') };
}
