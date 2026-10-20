export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num) || clean.length !== 6) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Color distance normalized to 0..100% */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  // Max possible Euclidean distance is sqrt(255^2 * 3) ~= 441.673
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  return (dist / 441.67295593) * 100;
}

/**
 * Samples four corners (up to 10x10 patch in each corner)
 * and returns the average corner RGB and hex string.
 */
export function detectCornerColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { r: number; g: number; b: number; hex: string } {
  const patchSize = Math.max(1, Math.min(10, Math.floor(width / 10), Math.floor(height / 10)));
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  const sampleRect = (startX: number, startY: number) => {
    for (let y = startY; y < startY + patchSize && y < height; y++) {
      for (let x = startX; x < startX + patchSize && x < width; x++) {
        const idx = (y * width + x) * 4;
        totalR += data[idx];
        totalG += data[idx + 1];
        totalB += data[idx + 2];
        count++;
      }
    }
  };

  sampleRect(0, 0); // Top-left
  sampleRect(Math.max(0, width - patchSize), 0); // Top-right
  sampleRect(0, Math.max(0, height - patchSize)); // Bottom-left
  sampleRect(Math.max(0, width - patchSize), Math.max(0, height - patchSize)); // Bottom-right

  if (count === 0) {
    return { r: 255, g: 255, b: 255, hex: '#ffffff' };
  }

  const r = Math.round(totalR / count);
  const g = Math.round(totalG / count);
  const b = Math.round(totalB / count);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}
