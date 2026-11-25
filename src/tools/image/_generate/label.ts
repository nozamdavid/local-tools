import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { translate } from '../../../lib/i18n';

export type ElementType = 'text' | 'rect' | 'line' | 'image' | 'qr' | 'barcode';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number; // mm
  y: number; // mm
  width: number; // mm
  height: number; // mm
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number; // pt (1 pt ~= 0.3528 mm)
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  color: string;
}

export interface RectElement extends BaseElement {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number; // mm
  rounded: number; // mm
}

export interface LineElement extends BaseElement {
  type: 'line';
  color: string;
  lineWidth: number; // mm
}

export interface ImageElement extends BaseElement {
  type: 'image';
  dataUrl: string;
}

export interface QrElement extends BaseElement {
  type: 'qr';
  text: string;
  ecLevel: 'L' | 'M' | 'Q' | 'H';
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode';
  format: 'CODE128' | 'EAN13' | 'UPC' | 'CODE39';
  value: string;
  showText: boolean;
}

export type LabelElement = TextElement | RectElement | LineElement | ImageElement | QrElement | BarcodeElement;

export interface LabelPreset {
  id: string;
  name: string;
  width: number; // mm
  height: number; // mm
  sheet: 'A4' | 'Letter';
  cols: number;
  rows: number;
  marginTop: number; // mm
  marginLeft: number; // mm
  gapX: number; // mm
  gapY: number; // mm
}

export const LABEL_PRESETS: LabelPreset[] = [
  {
    id: '50x25',
    name: '50 × 25 mm (Standard Label)',
    width: 50,
    height: 25,
    sheet: 'A4',
    cols: 4,
    rows: 10,
    marginTop: 10,
    marginLeft: 4,
    gapX: 2,
    gapY: 2,
  },
  {
    id: '62x29',
    name: '62 × 29 mm (Address / Shipping)',
    width: 62,
    height: 29,
    sheet: 'A4',
    cols: 3,
    rows: 9,
    marginTop: 15,
    marginLeft: 8,
    gapX: 4,
    gapY: 2,
  },
  {
    id: '100x50',
    name: '100 × 50 mm (Large Package)',
    width: 100,
    height: 50,
    sheet: 'A4',
    cols: 2,
    rows: 5,
    marginTop: 15,
    marginLeft: 4,
    gapX: 2,
    gapY: 5,
  },
  {
    id: '4x6',
    name: '4 × 6 in (101.6 × 152.4 mm Shipping)',
    width: 101.6,
    height: 152.4,
    sheet: 'Letter',
    cols: 2,
    rows: 1,
    marginTop: 25,
    marginLeft: 6,
    gapX: 0,
    gapY: 0,
  },
  {
    id: 'avery-3x8',
    name: 'Avery A4 3×8 (70 × 37 mm, 24 labels)',
    width: 70,
    height: 37,
    sheet: 'A4',
    cols: 3,
    rows: 8,
    marginTop: 13,
    marginLeft: 7,
    gapX: 0,
    gapY: 0,
  },
  {
    id: 'avery-2x7',
    name: 'Avery A4 2×7 (105 × 42.4 mm, 14 labels)',
    width: 105,
    height: 42.4,
    sheet: 'A4',
    cols: 2,
    rows: 7,
    marginTop: 13,
    marginLeft: 0,
    gapX: 0,
    gapY: 0,
  },
  {
    id: 'custom',
    name: 'Custom Size...',
    width: 70,
    height: 36,
    sheet: 'A4',
    cols: 3,
    rows: 7,
    marginTop: 15,
    marginLeft: 10,
    gapX: 2,
    gapY: 2,
  },
];

/** Renders a label onto an offscreen canvas at specified DPI (default 300 DPI) */
export async function renderLabelToCanvas(
  elements: LabelElement[],
  widthMm: number,
  heightMm: number,
  dpi: number = 300,
): Promise<HTMLCanvasElement> {
  const pxPerMm = dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthMm * pxPerMm));
  canvas.height = Math.max(1, Math.round(heightMm * pxPerMm));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(translate('Could not get 2D canvas context'));

  // Background is pure white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const el of elements) {
    const ex = el.x * pxPerMm;
    const ey = el.y * pxPerMm;
    const ew = el.width * pxPerMm;
    const eh = el.height * pxPerMm;

    switch (el.type) {
      case 'rect': {
        ctx.save();
        ctx.beginPath();
        const rPx = el.rounded * pxPerMm;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(ex, ey, ew, eh, rPx);
        } else {
          ctx.rect(ex, ey, ew, eh);
        }
        if (el.fill && el.fill !== 'transparent') {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        if (el.stroke && el.strokeWidth > 0) {
          ctx.lineWidth = el.strokeWidth * pxPerMm;
          ctx.strokeStyle = el.stroke;
          ctx.stroke();
        }
        ctx.restore();
        break;
      }

      case 'line': {
        ctx.save();
        ctx.beginPath();
        const lineY = ey + eh / 2;
        ctx.moveTo(ex, lineY);
        ctx.lineTo(ex + ew, lineY);
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.lineWidth * pxPerMm);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'text': {
        ctx.save();
        const fontPt = el.fontSize;
        const fontPx = fontPt * (dpi / 72);
        const styleStr = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${Math.round(fontPx)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
        ctx.font = styleStr;
        ctx.fillStyle = el.color;
        ctx.textBaseline = 'top';

        let textX = ex;
        if (el.align === 'center') {
          ctx.textAlign = 'center';
          textX = ex + ew / 2;
        } else if (el.align === 'right') {
          ctx.textAlign = 'right';
          textX = ex + ew;
        } else {
          ctx.textAlign = 'left';
        }

        // Handle multiline text
        const lines = el.text.split('\n');
        const lineHeight = fontPx * 1.25;
        for (let l = 0; l < lines.length; l++) {
          ctx.fillText(lines[l], textX, ey + l * lineHeight);
        }
        ctx.restore();
        break;
      }

      case 'image': {
        if (!el.dataUrl) break;
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = el.dataUrl;
          });
          ctx.drawImage(img, ex, ey, ew, eh);
        } catch (e) {
          console.warn('Failed to draw label image element:', e);
        }
        break;
      }

      case 'qr': {
        if (!el.text) break;
        try {
          const tempCanvas = document.createElement('canvas');
          await QRCode.toCanvas(tempCanvas, el.text, {
            errorCorrectionLevel: el.ecLevel || 'M',
            margin: 0,
            width: Math.round(Math.min(ew, eh)),
          });
          ctx.drawImage(tempCanvas, ex, ey, ew, eh);
        } catch (e) {
          console.warn('Failed to draw QR element:', e);
        }
        break;
      }

      case 'barcode': {
        if (!el.value) break;
        try {
          const tempCanvas = document.createElement('canvas');
          JsBarcode(tempCanvas, el.value, {
            format: el.format,
            displayValue: el.showText,
            margin: 0,
            font: 'monospace',
            fontSize: Math.max(12, Math.round(eh * 0.25)),
            height: Math.round(eh * (el.showText ? 0.65 : 0.95)),
          });
          ctx.drawImage(tempCanvas, ex, ey, ew, eh);
        } catch (e) {
          console.warn('Failed to draw barcode element:', e);
        }
        break;
      }
    }
  }

  return canvas;
}
