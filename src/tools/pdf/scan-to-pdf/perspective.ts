export interface Point {
  x: number;
  y: number;
}

/** Corners are ordered top-left, top-right, bottom-right, bottom-left in image coordinates. */
export type PerspectiveCorners = readonly [Point, Point, Point, Point];

export interface PerspectiveSize {
  width: number;
  height: number;
}

export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export const MAX_PERSPECTIVE_SIDE = 2400;
const MAX_PERSPECTIVE_PIXELS = MAX_PERSPECTIVE_SIDE * MAX_PERSPECTIVE_SIDE;

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Validates clockwise, convex corners in pixel-edge coordinates. */
export function validatePerspectiveCorners(corners: PerspectiveCorners, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Image dimensions must be positive integers.');
  }
  if (width > MAX_PERSPECTIVE_SIDE || height > MAX_PERSPECTIVE_SIDE || width * height > MAX_PERSPECTIVE_PIXELS) {
    throw new RangeError(`Image dimensions must not exceed ${MAX_PERSPECTIVE_SIDE} pixels per side.`);
  }
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some((point) => !point || !finitePoint(point))) {
    throw new RangeError('Provide four finite corner points.');
  }
  for (const point of corners) {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      throw new RangeError('Corner points must stay inside the image.');
    }
  }

  let twiceArea = 0;
  const turns: number[] = [];
  for (let index = 0; index < 4; index++) {
    const current = corners[index];
    const next = corners[(index + 1) % 4];
    const afterNext = corners[(index + 2) % 4];
    const edgeX = next.x - current.x;
    const edgeY = next.y - current.y;
    const nextX = afterNext.x - next.x;
    const nextY = afterNext.y - next.y;
    turns.push(edgeX * nextY - edgeY * nextX);
    twiceArea += current.x * next.y - next.x * current.y;
  }

  const epsilon = Math.max(1e-7, width * height * 1e-10);
  if (twiceArea <= epsilon || turns.some((turn) => turn <= epsilon)) {
    throw new RangeError('Corners must form a nondegenerate convex quadrilateral in top-left order.');
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Estimates a rectified rectangle from opposing edge lengths and applies the output side limit. */
export function getPerspectiveOutputSize(corners: PerspectiveCorners, maxSide = MAX_PERSPECTIVE_SIDE): PerspectiveSize {
  if (!Number.isSafeInteger(maxSide) || maxSide < 1 || maxSide > MAX_PERSPECTIVE_SIDE) {
    throw new RangeError(`Output side limit must be between 1 and ${MAX_PERSPECTIVE_SIDE}.`);
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const naturalWidth = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const naturalHeight = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new RangeError('The selected area has no usable size.');
  }
  const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  return {
    width: Math.max(1, Math.min(maxSide, Math.round(naturalWidth * scale))),
    height: Math.max(1, Math.min(maxSide, Math.round(naturalHeight * scale))),
  };
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const count = values.length;
  for (let column = 0; column < count; column++) {
    let pivotRow = column;
    for (let row = column + 1; row < count; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) pivotRow = row;
    }
    const pivot = matrix[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) {
      throw new RangeError('The selected corners cannot be transformed safely.');
    }
    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
    [values[column], values[pivotRow]] = [values[pivotRow], values[column]];

    const divisor = matrix[column][column];
    for (let index = column; index < count; index++) matrix[column][index] /= divisor;
    values[column] /= divisor;

    for (let row = 0; row < count; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (factor === 0) continue;
      for (let index = column; index < count; index++) matrix[row][index] -= factor * matrix[column][index];
      values[row] -= factor * values[column];
    }
  }
  return values;
}

/** Builds a transform from output pixel-edge coordinates back to the selected source corners. */
export function createDestinationToSourceHomography(width: number, height: number, corners: PerspectiveCorners): Homography {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Output dimensions must be positive.');
  }
  const destination: PerspectiveCorners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const equations: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = destination[index];
    const source = corners[index];
    equations.push([x, y, 1, 0, 0, 0, -source.x * x, -source.x * y]);
    values.push(source.x);
    equations.push([0, 0, 0, x, y, 1, -source.y * x, -source.y * y]);
    values.push(source.y);
  }
  const coefficients = solveLinearSystem(equations, values);
  const transform: Homography = [
    coefficients[0],
    coefficients[1],
    coefficients[2],
    coefficients[3],
    coefficients[4],
    coefficients[5],
    coefficients[6],
    coefficients[7],
    1,
  ];
  if (transform.some((value) => !Number.isFinite(value))) {
    throw new RangeError('The selected corners cannot be transformed safely.');
  }
  return transform;
}

export function mapHomography(transform: Homography, x: number, y: number): Point {
  const denominator = transform[6] * x + transform[7] * y + transform[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    throw new RangeError('The selected corners create a singular perspective transform.');
  }
  const point = {
    x: (transform[0] * x + transform[1] * y + transform[2]) / denominator,
    y: (transform[3] * x + transform[4] * y + transform[5]) / denominator,
  };
  if (!finitePoint(point)) throw new RangeError('The selected corners create an invalid perspective transform.');
  return point;
}

/** Applies a bilinear perspective warp. The source and result buffers are RGBA byte arrays. */
export function warpPerspective(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  corners: PerspectiveCorners,
  maxSide = MAX_PERSPECTIVE_SIDE,
): { data: Uint8ClampedArray; width: number; height: number } {
  validatePerspectiveCorners(corners, sourceWidth, sourceHeight);
  if (source.length !== sourceWidth * sourceHeight * 4) throw new RangeError('Pixel buffer size does not match image dimensions.');

  const size = getPerspectiveOutputSize(corners, maxSide);
  const pixelCount = size.width * size.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount < 1 || pixelCount > MAX_PERSPECTIVE_PIXELS) {
    throw new RangeError('The corrected image would be too large.');
  }
  const transform = createDestinationToSourceHomography(size.width, size.height, corners);
  const result = new Uint8ClampedArray(pixelCount * 4);

  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      const denominator = transform[6] * sampleX + transform[7] * sampleY + transform[8];
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
        throw new RangeError('The selected corners create a singular perspective transform.');
      }
      const mappedX = (transform[0] * sampleX + transform[1] * sampleY + transform[2]) / denominator;
      const mappedY = (transform[3] * sampleX + transform[4] * sampleY + transform[5]) / denominator;
      if (!Number.isFinite(mappedX) || !Number.isFinite(mappedY)) {
        throw new RangeError('The selected corners create an invalid perspective transform.');
      }
      const pixelX = Math.max(0, Math.min(sourceWidth - 1, mappedX - 0.5));
      const pixelY = Math.max(0, Math.min(sourceHeight - 1, mappedY - 0.5));
      const left = Math.floor(pixelX);
      const top = Math.floor(pixelY);
      const right = Math.min(sourceWidth - 1, left + 1);
      const bottom = Math.min(sourceHeight - 1, top + 1);
      const mixX = pixelX - left;
      const mixY = pixelY - top;
      const outputIndex = (y * size.width + x) * 4;
      const topLeftIndex = (top * sourceWidth + left) * 4;
      const topRightIndex = (top * sourceWidth + right) * 4;
      const bottomLeftIndex = (bottom * sourceWidth + left) * 4;
      const bottomRightIndex = (bottom * sourceWidth + right) * 4;

      for (let channel = 0; channel < 4; channel++) {
        const upper = source[topLeftIndex + channel] * (1 - mixX) + source[topRightIndex + channel] * mixX;
        const lower = source[bottomLeftIndex + channel] * (1 - mixX) + source[bottomRightIndex + channel] * mixX;
        result[outputIndex + channel] = upper * (1 - mixY) + lower * mixY;
      }
    }
  }

  return { data: result, width: size.width, height: size.height };
}
