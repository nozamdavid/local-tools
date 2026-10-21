/**
 * Paper background removal and ink extraction for signatures and stamps.
 * Preserves thin dark lines and saturated colored ink (e.g. red/blue stamps).
 * Supports transparent and white output, contrast and detail controls, and bounding box auto-crop.
 */

export interface CleanerOptions {
  preset: 'signature' | 'stamp';
  threshold: number; // 50 to 255
  detail: number; // 1 to 100 (feathering / edge smoothness)
  contrast: number; // 0 to 100 (ink darkening / saturation boost)
  outputMode: 'transparent' | 'white';
  cropToInk: boolean;
  cropPadding?: number;
}

export interface CleanerResult {
  outputData: Uint8ClampedArray;
  width: number;
  height: number;
  isEmpty: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export function cleanSignaturePixels(inputData: Uint8ClampedArray, width: number, height: number, options: CleanerOptions): CleanerResult {
  const outputData = new Uint8ClampedArray(width * height * 4);
  const feather = Math.max(1, options.detail * 0.8);
  const contrastFactor = 1 + options.contrast / 50;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = inputData[idx];
      const g = inputData[idx + 1];
      const b = inputData[idx + 2];
      const a = inputData[idx + 3];

      if (a === 0) {
        if (options.outputMode === 'white') {
          outputData[idx] = 255;
          outputData[idx + 1] = 255;
          outputData[idx + 2] = 255;
          outputData[idx + 3] = 255;
        } else {
          outputData[idx] = 0;
          outputData[idx + 1] = 0;
          outputData[idx + 2] = 0;
          outputData[idx + 3] = 0;
        }
        continue;
      }

      // Perceptual luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;

      // In stamp mode, high saturation (chroma) protects colorful ink even if bright
      const chromaProtection = options.preset === 'stamp' ? chroma * 0.9 : chroma * 0.45;
      const effectiveL = Math.max(0, lum - chromaProtection);

      const paperLevel = options.threshold;
      const delta = paperLevel - effectiveL;

      let inkStrength = 0;
      if (delta > 0) {
        inkStrength = Math.min(1, delta / feather);
        // Apply contrast curve
        inkStrength = Math.min(1, Math.pow(inkStrength, 1 / Math.max(0.5, contrastFactor)));
      }

      const isInk = inkStrength > 0.05;
      if (isInk) {
        inkCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (options.outputMode === 'transparent') {
        if (inkStrength <= 0) {
          outputData[idx] = 0;
          outputData[idx + 1] = 0;
          outputData[idx + 2] = 0;
          outputData[idx + 3] = 0;
        } else {
          // Un-mix from white paper background to eliminate halo
          const unmixedR = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - inkStrength)) / inkStrength)));
          const unmixedG = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - inkStrength)) / inkStrength)));
          const unmixedB = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - inkStrength)) / inkStrength)));

          // Darken ink according to contrast
          const darkening = 1 - options.contrast / 300;
          outputData[idx] = Math.max(0, Math.min(255, Math.round(unmixedR * darkening)));
          outputData[idx + 1] = Math.max(0, Math.min(255, Math.round(unmixedG * darkening)));
          outputData[idx + 2] = Math.max(0, Math.min(255, Math.round(unmixedB * darkening)));
          outputData[idx + 3] = Math.round(inkStrength * (a / 255) * 255);
        }
      } else {
        // Output mode: white background
        if (inkStrength <= 0) {
          outputData[idx] = 255;
          outputData[idx + 1] = 255;
          outputData[idx + 2] = 255;
          outputData[idx + 3] = 255;
        } else {
          const darkening = 1 - options.contrast / 300;
          const finalR = Math.max(0, Math.min(255, Math.round(r * darkening)));
          const finalG = Math.max(0, Math.min(255, Math.round(g * darkening)));
          const finalB = Math.max(0, Math.min(255, Math.round(b * darkening)));

          outputData[idx] = Math.round(255 - inkStrength * (255 - finalR));
          outputData[idx + 1] = Math.round(255 - inkStrength * (255 - finalG));
          outputData[idx + 2] = Math.round(255 - inkStrength * (255 - finalB));
          outputData[idx + 3] = 255;
        }
      }
    }
  }

  const isEmpty = inkCount === 0;
  const bounds = isEmpty ? null : { minX, minY, maxX, maxY };

  return {
    outputData,
    width,
    height,
    isEmpty,
    bounds,
  };
}

export function cropImageData(
  data: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  padding = 8,
  fillWhite = false,
): { croppedData: Uint8ClampedArray; cropWidth: number; cropHeight: number } {
  const padX0 = Math.max(0, bounds.minX - padding);
  const padY0 = Math.max(0, bounds.minY - padding);
  const padX1 = Math.min(srcWidth - 1, bounds.maxX + padding);
  const padY1 = Math.min(srcHeight - 1, bounds.maxY + padding);

  const cropWidth = Math.max(1, padX1 - padX0 + 1);
  const cropHeight = Math.max(1, padY1 - padY0 + 1);
  const croppedData = new Uint8ClampedArray(cropWidth * cropHeight * 4);

  if (fillWhite) {
    croppedData.fill(255);
  }

  for (let y = 0; y < cropHeight; y++) {
    const srcY = padY0 + y;
    if (srcY >= srcHeight) continue;
    for (let x = 0; x < cropWidth; x++) {
      const srcX = padX0 + x;
      if (srcX >= srcWidth) continue;

      const srcIdx = (srcY * srcWidth + srcX) * 4;
      const dstIdx = (y * cropWidth + x) * 4;

      croppedData[dstIdx] = data[srcIdx];
      croppedData[dstIdx + 1] = data[srcIdx + 1];
      croppedData[dstIdx + 2] = data[srcIdx + 2];
      croppedData[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return { croppedData, cropWidth, cropHeight };
}
