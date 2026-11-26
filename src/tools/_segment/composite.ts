import type { TextLayer, VideoMaxResolution } from './types';

export function calculateTargetSize(origW: number, origH: number, maxResolution: VideoMaxResolution): { width: number; height: number } {
  let targetMax: number;
  switch (maxResolution) {
    case '1080p':
      targetMax = 1920;
      break;
    case '720p':
      targetMax = 1280;
      break;
    case '480p':
      targetMax = 854;
      break;
    case 'original':
    default:
      targetMax = Infinity;
      break;
  }

  const longSide = Math.max(origW, origH);
  let scale = 1;
  if (longSide > targetMax) {
    scale = targetMax / longSide;
  }

  let width = Math.round(origW * scale);
  let height = Math.round(origH * scale);

  // Even dimensions required for video encoders
  if (width % 2 !== 0) width -= 1;
  if (height % 2 !== 0) height -= 1;

  width = Math.max(2, width);
  height = Math.max(2, height);

  return { width, height };
}

export function drawTextLayers(ctx: CanvasRenderingContext2D, layers: TextLayer[], width: number, height: number, baseScale = 1) {
  for (const layer of layers) {
    if (!layer.text) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    ctx.fillStyle = layer.color;

    const scaledSize = Math.max(6, Math.round(layer.fontSize * baseScale));
    ctx.font = `${layer.fontWeight} ${scaledSize}px ${layer.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Canvas letterSpacing support
    if ('letterSpacing' in ctx) {
      (ctx as any).letterSpacing = `${layer.letterSpacing * baseScale}px`;
    }

    const posX = layer.x * width;
    const posY = layer.y * height;

    ctx.translate(posX, posY);
    if (layer.rotation) {
      ctx.rotate((layer.rotation * Math.PI) / 180);
    }

    ctx.fillText(layer.text, 0, 0);
    ctx.restore();
  }
}

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchContext(width: number, height: number) {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
  }
  if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
    scratchCanvas.width = width;
    scratchCanvas.height = height;
  }
  scratchCtx ??= scratchCanvas.getContext('2d');
  return { canvas: scratchCanvas, ctx: scratchCtx };
}

export function drawSubjectOnTop(
  targetCtx: CanvasRenderingContext2D,
  frameImageData: ImageData,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const { canvas, ctx } = getScratchContext(width, height);
  if (!ctx) throw new Error('Could not create 2D canvas context');
  const subjectData = ctx.createImageData(width, height);
  const src = frameImageData.data;
  const dst = subjectData.data;
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    dst[p] = src[p];
    dst[p + 1] = src[p + 1];
    dst[p + 2] = src[p + 2];
    dst[p + 3] = mask[i];
  }

  ctx.putImageData(subjectData, 0, 0);
  targetCtx.drawImage(canvas, 0, 0);
}

export function compositeRemoveBackgroundFrame(
  targetCtx: CanvasRenderingContext2D,
  frameImageData: ImageData,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  mode: 'webm' | 'solid' | 'greenscreen',
  solidColor = '#ffffff',
) {
  if (mode === 'webm') {
    // Transparent background
    targetCtx.clearRect(0, 0, width, height);
    drawSubjectOnTop(targetCtx, frameImageData, mask, width, height);
  } else {
    // Solid background
    targetCtx.fillStyle = mode === 'greenscreen' ? '#00FF00' : solidColor;
    targetCtx.fillRect(0, 0, width, height);
    drawSubjectOnTop(targetCtx, frameImageData, mask, width, height);
  }
}
