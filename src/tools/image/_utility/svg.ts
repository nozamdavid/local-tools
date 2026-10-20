/**
 * SVG utilities for Raster to SVG conversion:
 * 1. Embedded raster data URI mode (preserving original image bytes inside an SVG container).
 * 2. Bounded pixel-rectangle vector mapping (converting pixels into crisp <rect> shapes with alpha support).
 */

export interface PixelSvgOptions {
  shapeRendering?: 'crispEdges' | 'auto';
  groupConsecutive?: boolean;
}

export function generateEmbeddedSvg(dataUri: string, width: number, height: number): string {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${safeW}" height="${safeH}" viewBox="0 0 ${safeW} ${safeH}">`,
    `  <image width="${safeW}" height="${safeH}" href="${dataUri}" />`,
    '</svg>',
  ].join('\n');
}

export function generatePixelSvg(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: PixelSvgOptions = {},
): string {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const rendering = options.shapeRendering || 'crispEdges';
  const groupConsecutive = options.groupConsecutive !== false;

  const rects: string[] = [];

  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const idx = (y * safeW + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      // Fully transparent pixels are omitted to preserve alpha
      if (a === 0) {
        continue;
      }

      let runLen = 1;
      if (groupConsecutive) {
        while (x + runLen < safeW) {
          const nextIdx = (y * safeW + (x + runLen)) * 4;
          if (
            pixels[nextIdx] === r &&
            pixels[nextIdx + 1] === g &&
            pixels[nextIdx + 2] === b &&
            pixels[nextIdx + 3] === a
          ) {
            runLen++;
          } else {
            break;
          }
        }
      }

      const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      const opacityAttr = a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : '';
      rects.push(
        `    <rect x="${x}" y="${y}" width="${runLen}" height="1" fill="${hexColor}"${opacityAttr} />`
      );

      if (groupConsecutive && runLen > 1) {
        x += runLen - 1;
      }
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeW}" height="${safeH}" viewBox="0 0 ${safeW} ${safeH}" shape-rendering="${rendering}">`,
    '  <g>',
    ...rects,
    '  </g>',
    '</svg>',
  ].join('\n');
}

export function validateSvgString(svg: string): boolean {
  if (!svg || typeof svg !== 'string') return false;
  const trimmed = svg.trim();
  const hasOpening = trimmed.includes('<svg') && trimmed.includes('xmlns="http://www.w3.org/2000/svg"');
  const hasClosing = trimmed.endsWith('</svg>');
  const hasViewBox = trimmed.includes('viewBox=');
  return hasOpening && hasClosing && hasViewBox;
}
