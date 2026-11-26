import { boxBlur } from './boxBlur';

export type ColorAdjustment = [name: 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'hue-rotate', amount: number];

type DrawImage = (ctx: CanvasRenderingContext2D) => void;

// The filter functions use sRGB matrices and leave alpha unchanged.
function applyColorAdjustments(data: Uint8ClampedArray, adjustments: ColorAdjustment[]) {
  for (const [name, amount] of adjustments) {
    const factor = amount / 100;
    if (name === 'brightness' || name === 'contrast') {
      const offset = name === 'contrast' ? 127.5 * (1 - factor) : 0;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] * factor + offset;
        data[i + 1] = data[i + 1] * factor + offset;
        data[i + 2] = data[i + 2] * factor + offset;
      }
      continue;
    }

    let matrix: number[];
    switch (name) {
      case 'grayscale':
        matrix = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];
        break;
      case 'sepia':
        matrix = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
        break;
      case 'saturate':
        matrix = [0.213, 0.715, 0.072, 0.213, 0.715, 0.072, 0.213, 0.715, 0.072];
        break;
      case 'hue-rotate': {
        const angle = (amount * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        matrix = [
          0.213 + cos * 0.787 - sin * 0.213,
          0.715 - cos * 0.715 - sin * 0.715,
          0.072 - cos * 0.072 + sin * 0.928,
          0.213 - cos * 0.213 + sin * 0.143,
          0.715 + cos * 0.285 + sin * 0.14,
          0.072 - cos * 0.072 - sin * 0.283,
          0.213 - cos * 0.213 - sin * 0.787,
          0.715 - cos * 0.715 + sin * 0.715,
          0.072 + cos * 0.928 + sin * 0.072,
        ];
        break;
      }
    }

    if (name !== 'hue-rotate') {
      const mix = name === 'saturate' ? 1 - factor : factor;
      matrix = matrix.map((coefficient, index) => coefficient * mix + (index % 4 === 0 ? 1 - mix : 0));
    }
    const [rr, rg, rb, gr, gg, gb, br, bg, bb] = matrix;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      data[i] = rr * r + rg * g + rb * b;
      data[i + 1] = gr * r + gg * g + gb * b;
      data[i + 2] = br * r + bg * g + bb * b;
    }
  }
}

// A CSS blur radius is a standard deviation. Match its variance with three box passes.
function blurRadii(sigma: number) {
  const lower = Math.floor((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2);
  const widerPasses = Math.round((3 * (sigma * sigma - lower * (lower + 1))) / (2 * (lower + 1)));
  return [0, 1, 2].map((pass) => lower + Number(pass < widerPasses));
}

function applyBlur({ data, width, height }: ImageData, radii: number[]) {
  // Keep extra precision in premultiplied space for translucent edges.
  const pixels = new Uint16Array(data.length);
  const scratch = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    pixels[i] = data[i] * alpha;
    pixels[i + 1] = data[i + 1] * alpha;
    pixels[i + 2] = data[i + 2] * alpha;
    pixels[i + 3] = 255 * alpha;
  }
  for (const radius of radii) {
    if (radius === 0) continue;
    boxBlur(pixels, scratch, width, height, 4, width * 4, radius, true);
    boxBlur(scratch, pixels, height, width, width * 4, 4, radius, true);
  }
  for (let i = 0; i < data.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    data[i + 3] = alpha;
    if (data[i + 3] > 0) {
      data[i] = pixels[i] / alpha;
      data[i + 1] = pixels[i + 1] / alpha;
      data[i + 2] = pixels[i + 2] / alpha;
    } else {
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
}

export function drawWithImageFilters(
  ctx: CanvasRenderingContext2D,
  draw: DrawImage,
  {
    colors = [],
    blur = 0,
    bounds = { x: 0, y: 0, width: ctx.canvas.width, height: ctx.canvas.height },
  }: { colors?: ColorAdjustment[]; blur?: number; bounds?: { x: number; y: number; width: number; height: number } },
) {
  if (colors.length === 0 && blur === 0) {
    draw(ctx);
    return;
  }
  if (typeof ctx.filter === 'string') {
    const filters = colors.map(([name, amount]) => `${name}(${amount}${name === 'hue-rotate' ? 'deg' : '%'})`);
    if (blur > 0) filters.push(`blur(${blur}px)`);
    ctx.save();
    ctx.filter = filters.join(' ');
    draw(ctx);
    ctx.restore();
    return;
  }

  const radii = blurRadii(blur);
  // Sample around the output bounds so clipped regions still pick up their surroundings.
  const pad = radii[0] + radii[1] + radii[2];
  const x = Math.max(0, bounds.x);
  const y = Math.max(0, bounds.y);
  const width = Math.min(ctx.canvas.width, bounds.x + bounds.width) - x;
  const height = Math.min(ctx.canvas.height, bounds.y + bounds.height) - y;
  if (width <= 0 || height <= 0) return;

  const canvas = document.createElement('canvas');
  canvas.width = width + 2 * pad;
  canvas.height = height + 2 * pad;
  const sample = canvas.getContext('2d', { willReadFrequently: true });
  if (!sample) throw new Error('Canvas 2D context unavailable.');

  sample.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
  sample.imageSmoothingQuality = ctx.imageSmoothingQuality;
  sample.translate(pad - x, pad - y);
  draw(sample);
  const pixels = sample.getImageData(0, 0, canvas.width, canvas.height);
  applyColorAdjustments(pixels.data, colors);
  if (pad > 0) applyBlur(pixels, radii);
  sample.putImageData(pixels, 0, 0);
  ctx.drawImage(canvas, pad, pad, width, height, x, y, width, height);
  canvas.width = 0;
}
