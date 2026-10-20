import type { PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';

export interface VisualDims {
  pdfWidth: number;
  pdfHeight: number;
  visualWidth: number;
  visualHeight: number;
  rotation: number; // 0, 90, 180, 270
}

export interface PdfPlacement {
  x: number;
  y: number;
  rotateDegrees: number;
}

/**
 * Returns visual page dimensions and PDF page rotation (0, 90, 180, 270).
 * In PDF, when a page has /Rotate 90 or 270, visual width/height are swapped.
 */
export function getVisualPageDims(page: PDFPage): VisualDims {
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();
  const rawAngle = page.getRotation().angle;
  const rotation = ((rawAngle % 360) + 360) % 360;
  const isSideways = rotation === 90 || rotation === 270;
  return {
    pdfWidth,
    pdfHeight,
    visualWidth: isSideways ? pdfHeight : pdfWidth,
    visualHeight: isSideways ? pdfWidth : pdfHeight,
    rotation,
  };
}

/**
 * Maps a visual position (x, y from visual bottom-left) and visual orientation angle
 * (counter-clockwise degrees) to PDF coordinate system (x, y from PDF bottom-left)
 * and total PDF rotation angle.
 */
export function mapVisualToPdf(
  visualPos: { x: number; y: number; angle?: number },
  dims: VisualDims
): PdfPlacement {
  const { pdfWidth, pdfHeight, rotation } = dims;
  const xv = visualPos.x;
  const yv = visualPos.y;
  const visualAngle = visualPos.angle ?? 0;
  const rotateDegrees = (((rotation + visualAngle) % 360) + 360) % 360;

  switch (rotation) {
    case 90:
      return {
        x: pdfWidth - yv,
        y: xv,
        rotateDegrees,
      };
    case 180:
      return {
        x: pdfWidth - xv,
        y: pdfHeight - yv,
        rotateDegrees,
      };
    case 270:
      return {
        x: yv,
        y: pdfHeight - xv,
        rotateDegrees,
      };
    case 0:
    default:
      return {
        x: xv,
        y: yv,
        rotateDegrees,
      };
  }
}

/**
 * Calculates the visual origin (bottom-left) of an object with (width, height)
 * centered at visual point (cx, cy) and rotated by angleDegrees counter-clockwise.
 */
export function calcRotatedCenterVisualOrigin(
  cx: number,
  cy: number,
  width: number,
  height: number,
  angleDegrees: number
): { x: number; y: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = width / 2;
  const halfH = height / 2;
  const dx = -halfW * cos + halfH * sin;
  const dy = -halfW * sin - halfH * cos;
  return {
    x: cx + dx,
    y: cy + dy,
  };
}

/**
 * Converts a hex color string like '#ff0000' to pdf-lib rgb() Color.
 */
export function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}
