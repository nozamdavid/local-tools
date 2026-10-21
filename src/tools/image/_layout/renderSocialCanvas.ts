import type { FitMode, BgType, TransformState } from './types';

export interface RenderOptions {
  width: number;
  height: number;
  fitMode: FitMode;
  bgType: BgType;
  bgColor: string;
  transform: TransformState;
  circularClip?: boolean;
}

export function renderFrameCanvas(img: HTMLImageElement, options: RenderOptions): HTMLCanvasElement {
  const { width, height, fitMode, bgType, bgColor, transform, circularClip } = options;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.imageSmoothingQuality = 'high';

  // 1. Draw background
  if (bgType === 'color' || fitMode === 'cover') {
    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);
    }
  } else if (bgType === 'blur' && fitMode === 'contain') {
    // Draw blurred image to fill frame
    ctx.save();
    try {
      ctx.filter = 'blur(40px)';
    } catch {
      // Fallback if browser doesn't support ctx.filter
    }
    // Margin of 80px to avoid border artifacts
    ctx.drawImage(img, -80, -80, width + 160, height + 160);
    ctx.restore();

    // Subtle dark tint to improve contrast
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Compute image placement
  const imgW = img.naturalWidth || img.width || 1;
  const imgH = img.naturalHeight || img.height || 1;

  const baseScale = fitMode === 'cover' ? Math.max(width / imgW, height / imgH) : Math.min(width / imgW, height / imgH);

  const finalScale = baseScale * Math.max(0.1, transform.zoom);
  const drawW = imgW * finalScale;
  const drawH = imgH * finalScale;
  const drawX = (width - drawW) / 2 + transform.panX;
  const drawY = (height - drawH) / 2 + transform.panY;

  // 3. Draw image (with optional circular clip)
  ctx.save();
  if (circularClip) {
    ctx.beginPath();
    const radius = Math.min(width, height) / 2;
    ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  return canvas;
}
