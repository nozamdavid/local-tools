import { colorDistance, type RGB } from './color';

export interface SolidRemovalOptions {
  targetColor: RGB;
  tolerance: number; // 0 to 100
  softness: number; // 0 to 50
  contiguous: boolean; // flood fill from edges vs global key
  despill: boolean;
}

/**
 * Computes a transparency mask and modifies pixel data for solid background removal.
 * Returns a new Uint8ClampedArray representing the processed RGBA pixel data.
 */
export function removeSolidBackground(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  options: SolidRemovalOptions,
): Uint8ClampedArray {
  const { targetColor, tolerance, softness, contiguous, despill } = options;
  const totalPixels = width * height;
  const out = new Uint8ClampedArray(srcData);

  const tr = targetColor.r;
  const tg = targetColor.g;
  const tb = targetColor.b;

  // Pre-calculate per-pixel distance and raw alpha
  // alpha: 0 (transparent background) to 255 (opaque foreground)
  const alphas = new Uint8ClampedArray(totalPixels);
  const distances = new Float32Array(totalPixels);

  const softRange = Math.max(0.1, softness);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = srcData[idx];
    const g = srcData[idx + 1];
    const b = srcData[idx + 2];
    const origA = srcData[idx + 3];

    if (origA === 0) {
      alphas[i] = 0;
      distances[i] = 0;
      continue;
    }

    const dist = colorDistance(r, g, b, tr, tg, tb);
    distances[i] = dist;

    if (dist <= tolerance) {
      alphas[i] = 0;
    } else if (dist < tolerance + softRange) {
      const factor = (dist - tolerance) / softRange;
      alphas[i] = Math.round(factor * origA);
    } else {
      alphas[i] = origA;
    }
  }

  if (contiguous) {
    // Flood fill from edges
    // Visited: 0 = unvisited (foreground), 1 = visited (background)
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    // Enqueue perimeter pixels that match background or soft transition
    const enqueue = (x: number, y: number) => {
      const idx = y * width + x;
      if (visited[idx] === 0 && distances[idx] < tolerance + softRange) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < width; x++) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    // BFS flood fill
    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      // Check 4 neighbors
      if (cx > 0) {
        const left = curr - 1;
        if (visited[left] === 0 && distances[left] < tolerance + softRange) {
          visited[left] = 1;
          queue[tail++] = left;
        }
      }
      if (cx < width - 1) {
        const right = curr + 1;
        if (visited[right] === 0 && distances[right] < tolerance + softRange) {
          visited[right] = 1;
          queue[tail++] = right;
        }
      }
      if (cy > 0) {
        const up = curr - width;
        if (visited[up] === 0 && distances[up] < tolerance + softRange) {
          visited[up] = 1;
          queue[tail++] = up;
        }
      }
      if (cy < height - 1) {
        const down = curr + width;
        if (visited[down] === 0 && distances[down] < tolerance + softRange) {
          visited[down] = 1;
          queue[tail++] = down;
        }
      }
    }

    // Apply alpha: only visited pixels become transparent or soft.
    // Unvisited pixels keep original alpha!
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      if (visited[i] === 1) {
        out[idx + 3] = alphas[i];
      } else {
        out[idx + 3] = srcData[idx + 3];
      }
    }
  } else {
    // Global colour key
    for (let i = 0; i < totalPixels; i++) {
      out[i * 4 + 3] = alphas[i];
    }
  }

  // Optional despill on semi-transparent or edge pixels
  if (despill) {
    applyDespill(out, width, height, targetColor);
  }

  return out;
}

/** Despills color cast from edges */
export function applyDespill(data: Uint8ClampedArray, width: number, height: number, targetColor: RGB) {
  const totalPixels = width * height;
  const { r: tr, g: tg, b: tb } = targetColor;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const a = data[idx + 3];
    if (a === 0 || a === 255) continue; // Only semi-transparent edge pixels

    let r = data[idx];
    let g = data[idx + 1];
    let b = data[idx + 2];

    // If target color is dominant in this pixel, suppress excess
    if (tg > tr && tg > tb) {
      // Green screen despill
      const maxOther = Math.max(r, b);
      if (g > maxOther) g = maxOther;
    } else if (tb > tr && tb > tg) {
      // Blue screen despill
      const maxOther = Math.max(r, g);
      if (b > maxOther) b = maxOther;
    } else if (tr > tg && tr > tb) {
      // Red / Pink screen despill
      const maxOther = Math.max(g, b);
      if (r > maxOther) r = maxOther;
    } else {
      // Neutral / White despill: push towards local luminance
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const alphaFactor = a / 255;
      r = Math.round(r * alphaFactor + lum * (1 - alphaFactor));
      g = Math.round(g * alphaFactor + lum * (1 - alphaFactor));
      b = Math.round(b * alphaFactor + lum * (1 - alphaFactor));
    }

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
  }
}

/**
 * Applies an AI-generated segmentation mask (0..255) to an image with threshold and feathering.
 */
export function applyAiMask(
  srcData: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 128, // 0..255
  feather: number = 2, // 0..20 px
): Uint8ClampedArray {
  const totalPixels = width * height;
  const out = new Uint8ClampedArray(srcData);

  const softRange = Math.max(1, feather * 12);
  const minThresh = Math.max(0, threshold - softRange);
  const maxThresh = Math.min(255, threshold + softRange);
  const span = Math.max(1, maxThresh - minThresh);

  for (let i = 0; i < totalPixels; i++) {
    const m = mask[i];
    let finalAlpha: number;

    if (m >= maxThresh) {
      finalAlpha = 255;
    } else if (m <= minThresh) {
      finalAlpha = 0;
    } else {
      finalAlpha = Math.round(((m - minThresh) / span) * 255);
    }

    const origA = srcData[i * 4 + 3];
    out[i * 4 + 3] = Math.min(origA, finalAlpha);
  }

  return out;
}
