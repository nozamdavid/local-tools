import { type RGBA, type HSLA, formatHex, formatRgb, formatHsl, rgbToHsl } from './convert';
import { canvasToBlob } from '../../../lib/image';

export interface PaletteColor {
  rgba: RGBA;
  hsla: HSLA;
  hex: string;
  rgb: string;
  hsl: string;
  share: number; // percentage 0..100
  pixelCount: number;
}

interface Pixel {
  r: number;
  g: number;
  b: number;
}

interface ColorBox {
  pixels: Pixel[];
}

function getBoxRange(box: ColorBox): { dim: 'r' | 'g' | 'b'; range: number } {
  let minR = 255,
    maxR = 0;
  let minG = 255,
    maxG = 0;
  let minB = 255,
    maxB = 0;

  for (const p of box.pixels) {
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
    if (p.g < minG) minG = p.g;
    if (p.g > maxG) maxG = p.g;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  }

  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;

  if (rangeR >= rangeG && rangeR >= rangeB) return { dim: 'r', range: rangeR };
  if (rangeG >= rangeR && rangeG >= rangeB) return { dim: 'g', range: rangeG };
  return { dim: 'b', range: rangeB };
}

export function extractPalette(ctx: CanvasRenderingContext2D, width: number, height: number, colorCount: number = 8): PaletteColor[] {
  const targetCount = Math.min(12, Math.max(5, colorCount));
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Downsample deterministically to around 10,000 pixels max
  const totalPixels = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / 10000)));

  const validPixels: Pixel[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a >= 128) {
        // Only sample non-transparent pixels
        validPixels.push({
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2],
        });
      }
    }
  }

  if (validPixels.length === 0) {
    // Default fallback to black/white if image is completely transparent
    const fallback: RGBA = { r: 0, g: 0, b: 0, a: 1 };
    const hsla = rgbToHsl(fallback);
    return [
      {
        rgba: fallback,
        hsla,
        hex: '#000000',
        rgb: 'rgb(0, 0, 0)',
        hsl: 'hsl(0, 0%, 0%)',
        share: 100,
        pixelCount: 1,
      },
    ];
  }

  // Median-cut algorithm
  const boxes: ColorBox[] = [{ pixels: validPixels }];

  while (boxes.length < targetCount) {
    // Find box with greatest range that has more than 1 pixel
    let maxRange = -1;
    let splitIdx = -1;
    let splitDim: 'r' | 'g' | 'b' = 'r';

    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].pixels.length <= 1) continue;
      const { dim, range } = getBoxRange(boxes[i]);
      if (range > maxRange) {
        maxRange = range;
        splitIdx = i;
        splitDim = dim;
      }
    }

    if (splitIdx === -1 || maxRange === 0) {
      // Cannot split further
      break;
    }

    const boxToSplit = boxes.splice(splitIdx, 1)[0];
    boxToSplit.pixels.sort((a, b) => a[splitDim] - b[splitDim]);

    const median = Math.floor(boxToSplit.pixels.length / 2);
    const box1: ColorBox = { pixels: boxToSplit.pixels.slice(0, median) };
    const box2: ColorBox = { pixels: boxToSplit.pixels.slice(median) };

    boxes.push(box1, box2);
  }

  const totalCount = validPixels.length;

  const result: PaletteColor[] = boxes.map((box) => {
    let sumR = 0,
      sumG = 0,
      sumB = 0;
    for (const p of box.pixels) {
      sumR += p.r;
      sumG += p.g;
      sumB += p.b;
    }
    const count = box.pixels.length;
    const r = Math.round(sumR / count);
    const g = Math.round(sumG / count);
    const b = Math.round(sumB / count);

    const rgba: RGBA = { r, g, b, a: 1 };
    const hsla = rgbToHsl(rgba);
    const share = Math.round((count / totalCount) * 1000) / 10;

    return {
      rgba,
      hsla,
      hex: formatHex(rgba, 6),
      rgb: formatRgb(rgba),
      hsl: formatHsl(hsla),
      share,
      pixelCount: count,
    };
  });

  // Sort descending by share
  result.sort((a, b) => b.share - a.share);

  return result;
}

export async function generatePaletteStripBlob(palette: PaletteColor[], width = 800, height = 140): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const count = palette.length;
  const blockWidth = width / count;

  palette.forEach((color, i) => {
    const x = i * blockWidth;
    ctx.fillStyle = color.hex;
    ctx.fillRect(x, 0, Math.ceil(blockWidth), height);

    // Add label at the bottom
    ctx.fillStyle = color.rgba.r * 0.299 + color.rgba.g * 0.587 + color.rgba.b * 0.114 > 150 ? '#000000' : '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(color.hex.toUpperCase(), x + blockWidth / 2, height - 20);
    ctx.font = '12px sans-serif';
    ctx.fillText(`${color.share}%`, x + blockWidth / 2, height - 38);
  });

  return canvasToBlob(canvas, 'image/png');
}
