import { CanvasDocument, Layer, TextLayer, RedactLayer } from './types';
import { getFontStack } from './fonts';
import { canvasToBlob, EncodableMime } from '../../../lib/image';
import { translate } from '../../../lib/i18n';
import { rotationAxes } from '../../../lib/rotationCrop';
import { drawWithImageFilters, type ColorAdjustment } from '../_filters/canvasFilters';

function getColorAdjustments(doc: CanvasDocument): ColorAdjustment[] {
  const adj = doc.adjustments;
  if (!adj) return [];

  const parts: ColorAdjustment[] = [];
  switch (adj.preset) {
    case 'vivid':
      parts.push(['contrast', 130], ['saturate', 150]);
      break;
    case 'mono':
      parts.push(['grayscale', 100], ['contrast', 115]);
      break;
    case 'sepia':
      parts.push(['sepia', 100]);
      break;
    case 'vintage':
      parts.push(['sepia', 45], ['contrast', 120], ['brightness', 95], ['hue-rotate', -15]);
      break;
    case 'cool':
      parts.push(['contrast', 105], ['hue-rotate', 30], ['saturate', 110]);
      break;
    case 'warm':
      parts.push(['sepia', 25], ['saturate', 135], ['brightness', 105]);
      break;
  }

  if (adj.brightness !== undefined && adj.brightness !== 100) {
    parts.push(['brightness', adj.brightness]);
  }
  if (adj.contrast !== undefined && adj.contrast !== 100) {
    parts.push(['contrast', adj.contrast]);
  }
  if (adj.saturation !== undefined && adj.saturation !== 100) {
    parts.push(['saturate', adj.saturation]);
  }

  return parts;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function renderRedactLayer(ctx: CanvasRenderingContext2D, layer: RedactLayer, isPreview: boolean) {
  if (layer.redactType === 'solid') {
    ctx.fillStyle = '#000000';
    const angle = layer.rotation ?? 0;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    if (angle % 90 === 0) {
      const swap = angle % 180 !== 0;
      const width = swap ? layer.height : layer.width;
      const height = swap ? layer.width : layer.height;
      const x = Math.floor(cx - width / 2);
      const y = Math.floor(cy - height / 2);
      ctx.fillRect(x, y, Math.ceil(cx + width / 2) - x, Math.ceil(cy + height / 2) - y);
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((angle * Math.PI) / 180);
      // Cover the sampling footprint and keep antialiasing outside the redacted area.
      const bleed = 2;
      ctx.fillRect(-layer.width / 2 - bleed, -layer.height / 2 - bleed, layer.width + 2 * bleed, layer.height + 2 * bleed);
      ctx.restore();
    }
    return;
  }

  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const { cos, sin } = rotationAxes(layer.rotation ?? 0);
  const corners = [
    [-layer.width / 2, -layer.height / 2],
    [layer.width / 2, -layer.height / 2],
    [layer.width / 2, layer.height / 2],
    [-layer.width / 2, layer.height / 2],
  ].map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);
  const canvas = ctx.canvas;
  // Rotation followed by Reset can leave an integer boundary a fraction of a pixel off.
  const epsilon = 1e-9;
  const x = Math.max(0, Math.floor(Math.min(...corners.map(([px]) => px)) + epsilon));
  const y = Math.max(0, Math.floor(Math.min(...corners.map(([, py]) => py)) + epsilon));
  const rw = Math.min(canvas.width, Math.ceil(Math.max(...corners.map(([px]) => px)) - epsilon)) - x;
  const rh = Math.min(canvas.height, Math.ceil(Math.max(...corners.map(([, py]) => py)) - epsilon)) - y;
  if (rw <= 0 || rh <= 0) return;

  const pixelate = layer.redactType === 'pixelate';
  const pixelSize = Math.max(6, Math.round(Math.min(rw, rh) / 10));
  const temp = document.createElement('canvas');
  temp.width = pixelate ? Math.max(1, Math.round(rw / pixelSize)) : rw;
  temp.height = pixelate ? Math.max(1, Math.round(rh / pixelSize)) : rh;
  const tctx = temp.getContext('2d');
  if (!tctx) return;
  if (pixelate) tctx.drawImage(canvas, x, y, rw, rh, 0, 0, temp.width, temp.height);
  else drawWithImageFilters(tctx, (sample) => sample.drawImage(canvas, -x, -y), { blur: 10 });

  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (const [px, py] of corners.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  // Replace pixels in the mask so translucent output cannot reveal the original beneath it.
  ctx.globalCompositeOperation = 'copy';
  ctx.imageSmoothingEnabled = !pixelate;
  ctx.drawImage(temp, x, y, rw, rh);
  ctx.restore();
  if (isPreview) {
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
}

function renderTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer) {
  let text = layer.text;
  if (layer.uppercase) {
    text = text.toUpperCase();
  }

  const fontFamily = getFontStack(layer.fontFamily);
  const fontStyle = layer.fontStyle || 'normal';
  const fontWeight = layer.fontWeight || 'normal';
  let fontSize = layer.fontSize;

  // Split into lines
  const lines = text.split('\n');

  if (layer.autoFit && lines.length > 0) {
    // Auto-shrink font size to fit width
    const targetWidth = Math.max(20, layer.width - (layer.bgBoxPadding ? layer.bgBoxPadding * 2 : 10));
    for (let testSize = fontSize; testSize >= 12; testSize -= 2) {
      ctx.font = `${fontStyle} ${fontWeight} ${testSize}px ${fontFamily}`;
      const maxWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (maxWidth <= targetWidth || testSize <= 12) {
        fontSize = testSize;
        break;
      }
    }
  }

  const lineHeight = fontSize * (layer.lineHeight ?? 1.2);
  const totalTextHeight = lines.length * lineHeight;

  // Background box
  if (layer.bgBox) {
    const rad = layer.bgBoxRadius ?? 8;
    const bgOpacity = layer.bgBoxOpacity ?? 0.85;

    ctx.save();
    ctx.globalAlpha = (layer.opacity ?? 1) * bgOpacity;
    ctx.fillStyle = layer.bgBoxColor ?? '#000000';
    drawRoundedRect(ctx, 0, 0, layer.width, layer.height, rad);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = layer.textAlign ?? 'center';

  const align = layer.textAlign ?? 'center';
  let startX = layer.width / 2;
  if (align === 'left') {
    startX = layer.bgBox ? (layer.bgBoxPadding ?? 12) : 4;
  } else if (align === 'right') {
    startX = layer.width - (layer.bgBox ? (layer.bgBoxPadding ?? 12) : 4);
  }

  const startY = (layer.height - totalTextHeight) / 2 + lineHeight / 2;

  lines.forEach((line, i) => {
    const currY = startY + i * lineHeight;

    // Shadow
    if (layer.shadowColor) {
      ctx.save();
      ctx.shadowColor = layer.shadowColor;
      ctx.shadowBlur = layer.shadowBlur ?? 4;
      ctx.shadowOffsetX = layer.shadowOffsetX ?? 0;
      ctx.shadowOffsetY = layer.shadowOffsetY ?? 2;
      ctx.fillStyle = layer.fill;
      ctx.fillText(line, startX, currY);
      ctx.restore();
    }

    // Stroke outline
    if (layer.stroke && (layer.strokeWidth ?? 0) > 0) {
      ctx.save();
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth!;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, startX, currY);
      ctx.restore();
    }

    // Main fill
    ctx.fillStyle = layer.fill;
    ctx.fillText(line, startX, currY);
  });
}

export function renderLayer(ctx: CanvasRenderingContext2D, layer: Layer, isPreview = false) {
  if (layer.opacity !== undefined && layer.opacity <= 0) return;

  if (layer.type === 'redact') {
    renderRedactLayer(ctx, layer, isPreview);
    return;
  }

  ctx.save();

  if (layer.opacity !== undefined) {
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
  }

  // Freehand path uses absolute document coordinates
  if (layer.type === 'path') {
    if (layer.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(layer.points[0].x, layer.points[0].y);
      if (layer.points.length === 1) {
        ctx.lineTo(layer.points[0].x + 0.01, layer.points[0].y);
      }
      for (let i = 1; i < layer.points.length; i++) {
        ctx.lineTo(layer.points[i].x, layer.points[i].y);
      }
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (layer.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
      } else if (layer.isHighlighter) {
        ctx.globalAlpha = 0.35;
        ctx.stroke();
      } else {
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  // Transform matrix for bounding-box layers
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  ctx.translate(cx, cy);

  if (layer.rotation) {
    ctx.rotate((layer.rotation * Math.PI) / 180);
  }

  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  ctx.translate(-layer.width / 2, -layer.height / 2);

  const w = layer.width;
  const h = layer.height;

  switch (layer.type) {
    case 'text':
      renderTextLayer(ctx, layer);
      break;

    case 'image':
      if (layer.image) {
        ctx.drawImage(layer.image, 0, 0, w, h);
      }
      break;

    case 'rect':
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      if (layer.fill && layer.fill !== 'transparent') {
        ctx.fillStyle = layer.fill;
        ctx.fill();
      }
      if (layer.stroke && layer.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = layer.strokeWidth;
        ctx.stroke();
      }
      break;

    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      if (layer.fill && layer.fill !== 'transparent') {
        ctx.fillStyle = layer.fill;
        ctx.fill();
      }
      if (layer.stroke && layer.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = layer.strokeWidth;
        ctx.stroke();
      }
      break;

    case 'line':
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      break;

    case 'arrow': {
      const arrowCy = h / 2;
      const headLen = Math.min(w, Math.max(14, layer.strokeWidth * 3.2));

      // Line
      ctx.beginPath();
      ctx.moveTo(0, arrowCy);
      ctx.lineTo(Math.max(0, w - headLen * 0.7), arrowCy);
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(w, arrowCy);
      ctx.lineTo(w - headLen, arrowCy - headLen * 0.45);
      ctx.lineTo(w - headLen * 0.6, arrowCy);
      ctx.lineTo(w - headLen, arrowCy + headLen * 0.45);
      ctx.closePath();
      ctx.fillStyle = layer.stroke;
      ctx.fill();
      break;
    }

    case 'badge': {
      const radius = Math.min(w, h) / 2;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = layer.fill;
      ctx.fill();

      ctx.fillStyle = layer.textColor;
      ctx.font = `bold ${Math.round(radius * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(layer.number), w / 2, h / 2);
      break;
    }

    case 'callout': {
      const tailH = Math.min(16, h * 0.3);
      const boxH = h - tailH;
      const rad = 8;

      ctx.fillStyle = layer.fill;
      drawRoundedRect(ctx, 0, 0, w, boxH, rad);
      ctx.fill();

      // Tail
      ctx.beginPath();
      ctx.moveTo(w * 0.2, boxH);
      ctx.lineTo(w * 0.1, h);
      ctx.lineTo(w * 0.35, boxH);
      ctx.closePath();
      ctx.fill();

      // Text
      ctx.fillStyle = layer.textColor;
      ctx.font = `500 ${layer.fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, w / 2, boxH / 2);
      break;
    }
  }

  ctx.restore();
}

export function drawDocumentBase(ctx: CanvasRenderingContext2D, doc: CanvasDocument, withAdjustments = true) {
  const image = doc.baseImage;
  if (!image) return;
  const base = doc.baseTransform;
  drawWithImageFilters(
    ctx,
    (target) => {
      if (base) {
        target.save();
        target.translate(doc.width / 2, doc.height / 2);
        target.rotate((base.angle * Math.PI) / 180);
        target.scale(base.flipX ? -1 : 1, base.flipY ? -1 : 1);
        target.drawImage(image, -base.width / 2, -base.height / 2, base.width, base.height);
        target.restore();
      } else {
        target.drawImage(image, 0, 0, doc.width, doc.height);
      }
    },
    withAdjustments ? { colors: getColorAdjustments(doc), blur: Math.max(0, doc.adjustments?.blur || 0) } : {},
  );
}

export function renderDocument(ctx: CanvasRenderingContext2D, doc: CanvasDocument, isPreview = false) {
  ctx.clearRect(0, 0, doc.width, doc.height);

  if (doc.backgroundColor) {
    ctx.fillStyle = doc.backgroundColor;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  drawDocumentBase(ctx, doc);

  const solidRedactions: RedactLayer[] = [];
  for (const layer of doc.layers) {
    if (layer.type === 'redact' && layer.redactType === 'solid') {
      solidRedactions.push(layer);
      continue;
    }
    renderLayer(ctx, layer, isPreview);
  }
  // Keep redacted pixels covered even when a later brush stroke erases pixels.
  for (const layer of solidRedactions) renderLayer(ctx, layer, isPreview);
}

export async function exportDocument(doc: CanvasDocument, mime: EncodableMime, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(doc.width));
  canvas.height = Math.max(1, Math.round(doc.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(translate('Canvas 2D context unavailable.'));

  renderDocument(ctx, doc, false);
  return canvasToBlob(canvas, mime, quality);
}
