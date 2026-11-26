// Web Worker for convolution & heavy pixel processing (sharpen, photo-to-sketch, etc.)

import { boxBlur } from './boxBlur';

export interface SharpenOptions {
  amount: number;
  radius: number;
  threshold: number;
}

export interface SketchOptions {
  style: 'pencil' | 'color-sketch' | 'cartoon' | 'sepia' | 'oil';
  intensity: number;
}

export type ImageFilter = { type: 'sharpen'; options: SharpenOptions } | { type: 'sketch'; options: SketchOptions };

export type WorkerMessageRequest = ImageFilter & {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
};

export interface WorkerMessageResponse {
  id: number;
  data: Uint8ClampedArray;
  error?: string;
}

declare const self: {
  onmessage: (event: MessageEvent<WorkerMessageRequest>) => void;
  postMessage(response: WorkerMessageResponse, transfer?: Transferable[]): void;
};

// 3-pass fast Gaussian blur approximation
function fastGaussianBlur(src: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius));
  const bufA = new Uint8ClampedArray(src);
  const bufB = new Uint8ClampedArray(src.length);

  for (let pass = 0; pass < 3; pass++) {
    boxBlur(bufA, bufB, w, h, 4, w * 4, r);
    boxBlur(bufB, bufA, h, w, w * 4, 4, r);
  }
  return bufA;
}

function processSharpen(data: Uint8ClampedArray, w: number, h: number, opts: SharpenOptions): Uint8ClampedArray<ArrayBuffer> {
  const { amount = 1.0, radius = 2.0, threshold = 0 } = opts;
  const blurred = fastGaussianBlur(data, w, h, radius);
  const out = new Uint8ClampedArray(data.length);
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig = data[i + c];
      const blurVal = blurred[i + c];
      const diff = orig - blurVal;
      if (Math.abs(diff) >= threshold) {
        const val = orig + diff * amount;
        out[i + c] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
      } else {
        out[i + c] = orig;
      }
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}

function processSketch(data: Uint8ClampedArray, w: number, h: number, opts: SketchOptions): Uint8ClampedArray<ArrayBuffer> {
  const { style = 'pencil', intensity = 80 } = opts;
  const factor = intensity / 100;
  const len = data.length;
  const out = new Uint8ClampedArray(len);

  if (style === 'pencil') {
    // 1. Grayscale
    const gray = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      gray[i] = g;
      gray[i + 1] = g;
      gray[i + 2] = g;
      gray[i + 3] = data[i + 3];
    }
    // 2. Invert grayscale
    const inv = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      const invG = 255 - gray[i];
      inv[i] = invG;
      inv[i + 1] = invG;
      inv[i + 2] = invG;
      inv[i + 3] = data[i + 3];
    }
    // 3. Blur inverted
    const blurRadius = Math.max(2, Math.round(6 + factor * 8));
    const blurred = fastGaussianBlur(inv, w, h, blurRadius);

    // 4. Color dodge: (base * 255) / (255 - top)
    for (let i = 0; i < len; i += 4) {
      const base = gray[i];
      const top = blurred[i];
      let dodge: number;
      if (top >= 255) {
        dodge = 255;
      } else {
        dodge = Math.min(255, Math.round((base * 255) / (255 - top)));
      }
      out[i] = Math.round(data[i] * (1 - factor) + dodge * factor);
      out[i + 1] = Math.round(data[i + 1] * (1 - factor) + dodge * factor);
      out[i + 2] = Math.round(data[i + 2] * (1 - factor) + dodge * factor);
      out[i + 3] = data[i + 3];
    }
  } else if (style === 'color-sketch') {
    // Color sketch: per-channel dodge
    const inv = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      inv[i] = 255 - data[i];
      inv[i + 1] = 255 - data[i + 1];
      inv[i + 2] = 255 - data[i + 2];
      inv[i + 3] = data[i + 3];
    }
    const blurRadius = Math.max(2, Math.round(4 + factor * 6));
    const blurred = fastGaussianBlur(inv, w, h, blurRadius);

    for (let i = 0; i < len; i += 4) {
      for (let c = 0; c < 3; c++) {
        const base = data[i + c];
        const top = blurred[i + c];
        const dodge = top >= 255 ? 255 : Math.min(255, Math.round((base * 255) / (255 - top)));
        out[i + c] = Math.round(base * (1 - factor) + dodge * factor);
      }
      out[i + 3] = data[i + 3];
    }
  } else if (style === 'cartoon') {
    // Posterize + edge detection
    const levels = Math.max(3, Math.round(7 - factor * 3));
    const step = 255 / (levels - 1);

    // Sobel edge detection on luminance
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < len; i += 4) {
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;

        // Posterize colors
        for (let c = 0; c < 3; c++) {
          out[idx + c] = Math.round(Math.round(data[idx + c] / step) * step);
        }
        out[idx + 3] = data[idx + 3];

        // Edge detection
        if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
          const gx =
            -gray[(y - 1) * w + (x - 1)] +
            gray[(y - 1) * w + (x + 1)] -
            2 * gray[y * w + (x - 1)] +
            2 * gray[y * w + (x + 1)] -
            gray[(y + 1) * w + (x - 1)] +
            gray[(y + 1) * w + (x + 1)];

          const gy =
            -gray[(y - 1) * w + (x - 1)] -
            2 * gray[(y - 1) * w + x] -
            gray[(y - 1) * w + (x + 1)] +
            gray[(y + 1) * w + (x - 1)] +
            2 * gray[(y + 1) * w + x] +
            gray[(y + 1) * w + (x + 1)];

          const edge = Math.sqrt(gx * gx + gy * gy);
          if (edge > 70) {
            const darken = Math.min(1, (edge / 255) * factor * 1.5);
            out[idx] = Math.round(out[idx] * (1 - darken));
            out[idx + 1] = Math.round(out[idx + 1] * (1 - darken));
            out[idx + 2] = Math.round(out[idx + 2] * (1 - darken));
          }
        }
      }
    }
  } else if (style === 'sepia') {
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sr = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
      const sg = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
      const sb = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);

      out[i] = Math.round(r * (1 - factor) + sr * factor);
      out[i + 1] = Math.round(g * (1 - factor) + sg * factor);
      out[i + 2] = Math.round(b * (1 - factor) + sb * factor);
      out[i + 3] = data[i + 3];
    }
  } else if (style === 'oil') {
    // Kuwahara-lite filter (radius = 2 or 3)
    const rad = Math.max(1, Math.min(3, Math.round(1 + factor * 2)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;

        // 4 quadrants: [x-rad..x, y-rad..y], [x..x+rad, y-rad..y], [x-rad..x, y..y+rad], [x..x+rad, y..y+rad]
        const quadrants = [
          { x0: Math.max(0, x - rad), x1: x, y0: Math.max(0, y - rad), y1: y },
          { x0: x, x1: Math.min(w - 1, x + rad), y0: Math.max(0, y - rad), y1: y },
          { x0: Math.max(0, x - rad), x1: x, y0: y, y1: Math.min(h - 1, y + rad) },
          { x0: x, x1: Math.min(w - 1, x + rad), y0: y, y1: Math.min(h - 1, y + rad) },
        ];

        let minVariance = Infinity;
        let bestMeanR = data[idx];
        let bestMeanG = data[idx + 1];
        let bestMeanB = data[idx + 2];

        for (const q of quadrants) {
          let count = 0;
          let sumR = 0,
            sumG = 0,
            sumB = 0;
          let sumSqR = 0,
            sumSqG = 0,
            sumSqB = 0;

          for (let qy = q.y0; qy <= q.y1; qy++) {
            for (let qx = q.x0; qx <= q.x1; qx++) {
              const qIdx = (qy * w + qx) * 4;
              const r = data[qIdx];
              const g = data[qIdx + 1];
              const b = data[qIdx + 2];
              sumR += r;
              sumG += g;
              sumB += b;
              sumSqR += r * r;
              sumSqG += g * g;
              sumSqB += b * b;
              count++;
            }
          }

          if (count > 0) {
            const mR = sumR / count;
            const mG = sumG / count;
            const mB = sumB / count;
            const varR = sumSqR / count - mR * mR;
            const varG = sumSqG / count - mG * mG;
            const varB = sumSqB / count - mB * mB;
            const totalVar = varR + varG + varB;

            if (totalVar < minVariance) {
              minVariance = totalVar;
              bestMeanR = mR;
              bestMeanG = mG;
              bestMeanB = mB;
            }
          }
        }

        out[idx] = Math.round(data[idx] * (1 - factor) + bestMeanR * factor);
        out[idx + 1] = Math.round(data[idx + 1] * (1 - factor) + bestMeanG * factor);
        out[idx + 2] = Math.round(data[idx + 2] * (1 - factor) + bestMeanB * factor);
        out[idx + 3] = data[idx + 3];
      }
    }
  } else {
    out.set(data);
  }

  return out;
}

self.onmessage = (e: MessageEvent<WorkerMessageRequest>) => {
  const { id, type, width, height, data, options } = e.data;
  try {
    let result: Uint8ClampedArray<ArrayBuffer>;
    if (type === 'sharpen') {
      result = processSharpen(data, width, height, options);
    } else if (type === 'sketch') {
      result = processSketch(data, width, height, options);
    } else {
      result = data;
    }
    const response: WorkerMessageResponse = { id, data: result };
    self.postMessage(response, [result.buffer]);
  } catch (err) {
    self.postMessage({ id, data, error: (err instanceof Error && err.message) || String(err) });
  }
};
