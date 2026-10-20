export type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export function hasAlphaChannel(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const u32 = new Uint32Array(data.buffer);
    const len = u32.length;
    // Fast step check
    const step = Math.max(1, Math.floor(len / 10000));
    for (let i = 0; i < len; i += step) {
      if ((u32[i] & 0xff000000) !== 0xff000000) {
        return true;
      }
    }
  } catch {
    // If security error, fallback
  }
  return false;
}

export function createPreviewCanvas(
  source: CanvasImageSource & { width: number; height: number },
  maxDim: number = 1200
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }
  return copy;
}
