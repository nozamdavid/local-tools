export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropBounds {
  width: number;
  height: number;
}

export type CropDragMode = 'draw' | 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w';

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export function clampCrop(rect: CropRect, bounds: CropBounds, minimum = 1): CropRect {
  const maxWidth = Math.max(1, Math.floor(finite(bounds.width, 1)));
  const maxHeight = Math.max(1, Math.floor(finite(bounds.height, 1)));
  const width = Math.max(1, Math.min(maxWidth, Math.round(finite(rect.width, 1))));
  const height = Math.max(1, Math.min(maxHeight, Math.round(finite(rect.height, 1))));
  const x = Math.max(0, Math.min(maxWidth - width, Math.round(finite(rect.x))));
  const y = Math.max(0, Math.min(maxHeight - height, Math.round(finite(rect.y))));
  const minWidth = Math.min(Math.max(1, minimum), maxWidth - x);
  const minHeight = Math.min(Math.max(1, minimum), maxHeight - y);
  return {
    x,
    y,
    width: Math.max(minWidth, width),
    height: Math.max(minHeight, height),
  };
}

function point(value: number, limit: number): number {
  return Math.max(0, Math.min(limit, finite(value)));
}

export function createCropSelection(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: CropBounds,
  aspect: number | null,
): CropRect {
  const startX = point(start.x, bounds.width);
  const startY = point(start.y, bounds.height);
  const endX = point(end.x, bounds.width);
  const endY = point(end.y, bounds.height);
  const directionX = endX < startX ? -1 : 1;
  const directionY = endY < startY ? -1 : 1;
  let width = Math.max(1, Math.abs(endX - startX));
  let height = Math.max(1, Math.abs(endY - startY));

  if (aspect && Number.isFinite(aspect) && aspect > 0) {
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    const availableWidth = directionX < 0 ? startX : bounds.width - startX;
    const availableHeight = directionY < 0 ? startY : bounds.height - startY;
    const fit = Math.min(1, availableWidth / width, availableHeight / height);
    width = Math.max(1, width * fit);
    height = Math.max(1, height * fit);
  }

  return clampCrop(
    {
      x: directionX < 0 ? startX - width : startX,
      y: directionY < 0 ? startY - height : startY,
      width,
      height,
    },
    bounds,
  );
}

export function moveCrop(rect: CropRect, dx: number, dy: number, bounds: CropBounds): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

export function resizeCrop(
  rect: CropRect,
  dx: number,
  dy: number,
  mode: Exclude<CropDragMode, 'draw' | 'move'>,
  bounds: CropBounds,
  aspect: number | null,
): CropRect {
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;
  const west = mode.includes('w');
  const east = mode.includes('e');
  const north = mode.includes('n');
  const south = mode.includes('s');

  if (west) left = Math.max(0, Math.min(right - 1, Math.round(rect.x + dx)));
  if (east) right = Math.min(bounds.width, Math.max(left + 1, Math.round(rect.x + rect.width + dx)));
  if (north) top = Math.max(0, Math.min(bottom - 1, Math.round(rect.y + dy)));
  if (south) bottom = Math.min(bounds.height, Math.max(top + 1, Math.round(rect.y + rect.height + dy)));

  let width = right - left;
  let height = bottom - top;
  if (aspect && Number.isFinite(aspect) && aspect > 0) {
    if ((west || east) && (north || south)) {
      if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
      const availableWidth = west ? right : bounds.width - left;
      const availableHeight = north ? bottom : bounds.height - top;
      const fit = Math.min(1, availableWidth / width, availableHeight / height);
      width *= fit;
      height *= fit;
      left = west ? right - width : left;
      right = left + width;
      top = north ? bottom - height : top;
      bottom = top + height;
    } else if (west || east) {
      const centerY = rect.y + rect.height / 2;
      width = west ? right - left : right - left;
      height = width / aspect;
      const availableWidth = west ? right : bounds.width - left;
      const availableHeight = Math.min(centerY, bounds.height - centerY) * 2;
      const fit = Math.min(1, availableWidth / width, availableHeight / height);
      width *= fit;
      height *= fit;
      left = west ? right - width : left;
      right = left + width;
      top = centerY - height / 2;
      bottom = top + height;
    } else if (north || south) {
      const centerX = rect.x + rect.width / 2;
      height = bottom - top;
      width = height * aspect;
      const availableHeight = north ? bottom : bounds.height - top;
      const availableWidth = Math.min(centerX, bounds.width - centerX) * 2;
      const fit = Math.min(1, availableHeight / height, availableWidth / width);
      width *= fit;
      height *= fit;
      left = centerX - width / 2;
      right = left + width;
      top = north ? bottom - height : top;
      bottom = top + height;
    }
  }

  return clampCrop({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
}

export function updateCropValue(rect: CropRect, key: keyof CropRect, value: number, bounds: CropBounds, aspect: number | null): CropRect {
  const next = { ...rect };
  const number = Math.max(0, Math.round(finite(value)));

  if (key === 'x') next.x = Math.min(bounds.width - next.width, number);
  if (key === 'y') next.y = Math.min(bounds.height - next.height, number);
  if (key === 'width') next.width = Math.min(bounds.width - next.x, Math.max(1, number));
  if (key === 'height') next.height = Math.min(bounds.height - next.y, Math.max(1, number));

  if (aspect && key === 'width') {
    next.height = Math.max(1, Math.min(bounds.height - next.y, Math.round(next.width / aspect)));
    next.width = Math.min(next.width, Math.round(next.height * aspect));
  } else if (aspect && key === 'height') {
    next.width = Math.max(1, Math.min(bounds.width - next.x, Math.round(next.height * aspect)));
    next.height = Math.min(next.height, Math.round(next.width / aspect));
  }

  return clampCrop(next, bounds);
}
