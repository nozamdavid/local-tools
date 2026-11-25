export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceBounds {
  width: number;
  height: number;
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function maxEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function roundEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validateBounds(bounds: SourceBounds) {
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width < 2 || bounds.height < 2) {
    throw new Error('Video dimensions must be at least two pixels on each side.');
  }
}

export function normalizeCrop(crop: CropRect, bounds: SourceBounds): CropRect {
  validateBounds(bounds);
  const width = maxEven(bounds.width);
  const height = maxEven(bounds.height);
  const w = clamp(roundEven(crop.w), 2, width);
  const h = clamp(roundEven(crop.h), 2, height);
  const x = clamp(Math.round(crop.x / 2) * 2, 0, width - w);
  const y = clamp(Math.round(crop.y / 2) * 2, 0, height - h);
  return { x, y, w, h };
}

export function centeredCrop(bounds: SourceBounds, ratio: number | null): CropRect {
  validateBounds(bounds);
  const width = maxEven(bounds.width);
  const height = maxEven(bounds.height);
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return { x: 0, y: 0, w: width, h: height };

  let w = width;
  let h = height;
  if (width / height > ratio) {
    w = Math.min(width, roundEven(height * ratio));
  } else {
    h = Math.min(height, roundEven(width / ratio));
  }

  if (w / h > ratio) w = Math.min(width, roundEven(h * ratio));
  else h = Math.min(height, roundEven(w / ratio));
  w = maxEven(w);
  h = maxEven(h);
  return normalizeCrop({ x: Math.round((width - w) / 4) * 2, y: Math.round((height - h) / 4) * 2, w, h }, bounds);
}

export function moveCrop(start: CropRect, deltaX: number, deltaY: number, bounds: SourceBounds): CropRect {
  const rect = normalizeCrop(start, bounds);
  return normalizeCrop({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY }, bounds);
}

function aspectSize(width: number, height: number, ratio: number, maxWidth: number, maxHeight: number): { w: number; h: number } {
  const projectedHeight = (width * ratio + height) / (ratio * ratio + 1);
  let h = clamp(roundEven(projectedHeight), 2, maxEven(maxHeight));
  let w = roundEven(h * ratio);

  if (w > maxEven(maxWidth)) {
    w = maxEven(maxWidth);
    h = clamp(roundEven(w / ratio), 2, maxEven(maxHeight));
  }
  if (h > maxEven(maxHeight)) {
    h = maxEven(maxHeight);
    w = Math.min(maxEven(maxWidth), roundEven(h * ratio));
  }
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

export function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
  bounds: SourceBounds,
  ratio: number | null,
): CropRect {
  const rect = normalizeCrop(start, bounds);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const horizontal = west || east;
  const vertical = north || south;
  const anchorX = west ? rect.x + rect.w : rect.x;
  const anchorY = north ? rect.y + rect.h : rect.y;
  const maxWidth = maxEven(
    horizontal ? (west ? anchorX : bounds.width - anchorX) : 2 * Math.min(rect.x + rect.w / 2, bounds.width - rect.x - rect.w / 2),
  );
  const maxHeight = maxEven(
    vertical ? (north ? anchorY : bounds.height - anchorY) : 2 * Math.min(rect.y + rect.h / 2, bounds.height - rect.y - rect.h / 2),
  );

  let w = horizontal ? rect.w + (east ? deltaX : -deltaX) : rect.w;
  let h = vertical ? rect.h + (south ? deltaY : -deltaY) : rect.h;

  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    if (horizontal && !vertical) h = w / ratio;
    else if (vertical && !horizontal) w = h * ratio;
    ({ w, h } = aspectSize(w, h, ratio, maxWidth, maxHeight));
  } else {
    w = clamp(roundEven(w), 2, Math.min(maxEven(maxWidth), maxEven(bounds.width)));
    h = clamp(roundEven(h), 2, Math.min(maxEven(maxHeight), maxEven(bounds.height)));
  }

  let x: number;
  let y: number;
  if (horizontal) x = west ? anchorX - w : anchorX;
  else x = rect.x + rect.w / 2 - w / 2;
  if (vertical) y = north ? anchorY - h : anchorY;
  else y = rect.y + rect.h / 2 - h / 2;

  return normalizeCrop({ x, y, w, h }, bounds);
}

export function drawCrop(startX: number, startY: number, endX: number, endY: number, bounds: SourceBounds, ratio: number | null): CropRect {
  validateBounds(bounds);
  const width = maxEven(bounds.width);
  const height = maxEven(bounds.height);
  const x0 = clamp(Math.round(startX / 2) * 2, 0, width);
  const y0 = clamp(Math.round(startY / 2) * 2, 0, height);
  const x1 = clamp(Math.round(endX / 2) * 2, 0, width);
  const y1 = clamp(Math.round(endY / 2) * 2, 0, height);
  let w = Math.max(2, Math.abs(x1 - x0));
  let h = Math.max(2, Math.abs(y1 - y0));
  const rightward = x1 >= x0;
  const downward = y1 >= y0;

  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    const maxWidth = rightward ? width - x0 : x0;
    const maxHeight = downward ? height - y0 : y0;
    ({ w, h } = aspectSize(w, h, ratio, maxWidth, maxHeight));
  }

  const x = rightward ? x0 : x0 - w;
  const y = downward ? y0 : y0 - h;
  return normalizeCrop({ x, y, w, h }, bounds);
}
