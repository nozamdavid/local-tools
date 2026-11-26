import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { CanvasDocument, Layer, TransformHandle, PathLayer } from './types';
import { renderDocument } from './render';
import { useI18n } from '../../../lib/i18n';
import styles from './CanvasStage.module.css';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StageMode = 'select' | 'draw' | 'shape' | 'crop' | 'view';

export interface ShapeConfig {
  type: 'rect' | 'ellipse' | 'arrow' | 'line' | 'redact';
  stroke: string;
  strokeWidth: number;
  fill?: string;
  redactType?: 'blur' | 'pixelate' | 'solid';
}

export interface DrawConfig {
  stroke: string;
  strokeWidth: number;
  isEraser?: boolean;
  isHighlighter?: boolean;
}

export interface CanvasStageProps {
  document: CanvasDocument;
  selectedLayerId: string | null;
  mode?: StageMode;
  shapeConfig?: ShapeConfig;
  drawConfig?: DrawConfig;
  cropRect?: CropRect;
  rotationPreview?: { delta: number; width: number; height: number };
  workspace?: boolean;
  onCropChange?: (rect: CropRect) => void;
  onSelectLayer: (layerId: string | null) => void;
  onPushDoc: (newDoc: CanvasDocument) => void;
  onDeleteLayer?: (layerId: string) => void;
}

type DragAction =
  | {
      type: 'move';
      layerId: string;
      startX: number;
      startY: number;
      origLayerX: number;
      origLayerY: number;
      origPoints?: Array<{ x: number; y: number }>;
    }
  | {
      type: 'resize';
      layerId: string;
      handle: TransformHandle;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      rotation: number;
    }
  | { type: 'rotate'; layerId: string; centerX: number; centerY: number; origRotation: number; startAngle: number }
  | { type: 'draw'; layer: PathLayer }
  | { type: 'create-shape'; startX: number; startY: number; shape: ShapeConfig }
  | { type: 'crop-move'; startX: number; startY: number; origRect: CropRect }
  | { type: 'crop-resize'; handle: string; startX: number; startY: number; origRect: CropRect };

export function CanvasStage({
  document: doc,
  selectedLayerId,
  mode = 'select',
  shapeConfig,
  drawConfig,
  cropRect,
  rotationPreview,
  workspace = false,
  onCropChange,
  onSelectLayer,
  onPushDoc,
  onDeleteLayer,
}: CanvasStageProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState({ width: Infinity, height: Infinity });
  const [zoomStep, setZoomStep] = useState(0);
  const fitScale = (width: number, height: number) => {
    const fit = Math.min(available.width / width, available.height / height, 1);
    return workspace ? fit : Math.max(0.05, fit);
  };
  const zoom = 2 ** (zoomStep / 2);
  const scale = fitScale(doc.width, doc.height) * zoom;
  const width = rotationPreview?.width ?? doc.width;
  const height = rotationPreview?.height ?? doc.height;
  const displayScale = rotationPreview ? fitScale(width, height) * zoom : scale;
  const nextLayer = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const dragActionRef = useRef<DragAction | null>(null);
  const [draftLayer, setDraftLayer] = useState<Layer | null>(null);

  // Resize listener to fit viewport
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const pad = workspace && !window.matchMedia('(max-width: 700px)').matches ? 56 : 32;
      const minimum = workspace ? 1 : 100;
      const availW = Math.max(minimum, clientWidth - pad);
      const availH = Math.max(minimum, (clientHeight || 520) - pad);
      setAvailable((previous) => (previous.width === availW && previous.height === availH ? previous : { width: availW, height: availH }));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateScale);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [workspace]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!workspace || !viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, [displayScale, width, height, workspace]);

  // Redraw canvas with layers & overlays
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const layers = draftLayer
      ? doc.layers.some((layer) => layer.id === draftLayer.id)
        ? doc.layers.map((layer) => (layer.id === draftLayer.id ? draftLayer : layer))
        : [...doc.layers, draftLayer]
      : doc.layers;
    renderDocument(ctx, { ...doc, layers }, true);

    const handleRadius = 6 / scale;
    const lineWidth = 1.5 / scale;
    const selectionColor = workspace ? '#c4f65d' : '#c026d3';

    // Draw active layer handles
    if (mode === 'select' && selectedLayerId) {
      const layer = layers.find((l) => l.id === selectedLayerId);
      if (layer && layer.type !== 'path') {
        ctx.save();
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        ctx.translate(cx, cy);
        if (layer.rotation) {
          ctx.rotate((layer.rotation * Math.PI) / 180);
        }
        ctx.translate(-layer.width / 2, -layer.height / 2);

        // Bounding box
        ctx.strokeStyle = selectionColor;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(0, 0, layer.width, layer.height);
        ctx.setLineDash([]);

        // Corner handles
        const handles: Array<{ x: number; y: number; h: TransformHandle }> = [
          { x: 0, y: 0, h: 'nw' },
          { x: layer.width, y: 0, h: 'ne' },
          { x: layer.width, y: layer.height, h: 'se' },
          { x: 0, y: layer.height, h: 'sw' },
        ];

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = selectionColor;
        ctx.lineWidth = lineWidth;

        handles.forEach(({ x, y }) => {
          ctx.beginPath();
          ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });

        // Rotation handle stem & knob (for rotatable layers)
        if (layer.type === 'text' || layer.type === 'image' || layer.type === 'rect' || layer.type === 'arrow') {
          const rotY = -22 / scale;
          ctx.beginPath();
          ctx.moveTo(layer.width / 2, 0);
          ctx.lineTo(layer.width / 2, rotY);
          ctx.strokeStyle = selectionColor;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(layer.width / 2, rotY, handleRadius * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = selectionColor;
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // Draw crop box overlay
    if (mode === 'crop' && cropRect) {
      ctx.save();

      // Dimmed exterior mask
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      // Top
      ctx.fillRect(0, 0, doc.width, cropRect.y);
      // Bottom
      ctx.fillRect(0, cropRect.y + cropRect.height, doc.width, doc.height - (cropRect.y + cropRect.height));
      // Left
      ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
      // Right
      ctx.fillRect(cropRect.x + cropRect.width, cropRect.y, doc.width - (cropRect.x + cropRect.width), cropRect.height);

      // Crop border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);

      // Rule-of-thirds grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1 / scale;
      const colW = cropRect.width / 3;
      const rowH = cropRect.height / 3;
      ctx.beginPath();
      ctx.moveTo(cropRect.x + colW, cropRect.y);
      ctx.lineTo(cropRect.x + colW, cropRect.y + cropRect.height);
      ctx.moveTo(cropRect.x + colW * 2, cropRect.y);
      ctx.lineTo(cropRect.x + colW * 2, cropRect.y + cropRect.height);
      ctx.moveTo(cropRect.x, cropRect.y + rowH);
      ctx.lineTo(cropRect.x + cropRect.width, cropRect.y + rowH);
      ctx.moveTo(cropRect.x, cropRect.y + rowH * 2);
      ctx.lineTo(cropRect.x + cropRect.width, cropRect.y + rowH * 2);
      ctx.stroke();

      // Corner markers
      const cSize = 14 / scale;
      const cThick = 3 / scale;
      ctx.fillStyle = '#ffffff';
      // NW
      ctx.fillRect(cropRect.x - cThick, cropRect.y - cThick, cSize, cThick * 2);
      ctx.fillRect(cropRect.x - cThick, cropRect.y - cThick, cThick * 2, cSize);
      // NE
      ctx.fillRect(cropRect.x + cropRect.width - cSize + cThick, cropRect.y - cThick, cSize, cThick * 2);
      ctx.fillRect(cropRect.x + cropRect.width - cThick, cropRect.y - cThick, cSize, cThick * 2);
      // SE
      ctx.fillRect(cropRect.x + cropRect.width - cSize + cThick, cropRect.y + cropRect.height - cThick, cSize, cThick * 2);
      ctx.fillRect(cropRect.x + cropRect.width - cThick, cropRect.y + cropRect.height - cSize + cThick, cThick * 2, cSize);
      // SW
      ctx.fillRect(cropRect.x - cThick, cropRect.y + cropRect.height - cThick, cSize, cThick * 2);
      ctx.fillRect(cropRect.x - cThick, cropRect.y + cropRect.height - cSize + cThick, cThick * 2, cSize);

      ctx.restore();
    }
  }, [doc, selectedLayerId, mode, scale, cropRect, draftLayer, workspace]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Coordinate helper
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (doc.width / rect.width);
    const y = (e.clientY - rect.top) * (doc.height / rect.height);
    return { x, y };
  };

  // Hit test handle
  const hitTestHandle = (layer: Layer, sx: number, sy: number): TransformHandle | null => {
    const hitRadius = 14 / scale;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const rad = -((layer.rotation || 0) * Math.PI) / 180;

    // Unrotate point into layer space
    const dx = sx - cx;
    const dy = sy - cy;
    const unrotX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const unrotY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

    // Rotate knob
    if (layer.type === 'text' || layer.type === 'image' || layer.type === 'rect' || layer.type === 'arrow') {
      const knobX = layer.x + layer.width / 2;
      const knobY = layer.y - 22 / scale;
      if (Math.hypot(unrotX - knobX, unrotY - knobY) <= hitRadius) {
        return 'rot';
      }
    }

    const handles: Array<{ x: number; y: number; h: TransformHandle }> = [
      { x: layer.x, y: layer.y, h: 'nw' },
      { x: layer.x + layer.width, y: layer.y, h: 'ne' },
      { x: layer.x + layer.width, y: layer.y + layer.height, h: 'se' },
      { x: layer.x, y: layer.y + layer.height, h: 'sw' },
    ];

    for (const h of handles) {
      if (Math.hypot(unrotX - h.x, unrotY - h.y) <= hitRadius) {
        return h.h;
      }
    }

    return null;
  };

  // Hit test layer body
  const hitTestLayer = (layer: Layer, sx: number, sy: number): boolean => {
    if (layer.type === 'path') {
      const thresh = Math.max(12 / scale, layer.strokeWidth / 2);
      for (const p of layer.points) {
        if (Math.hypot(p.x - sx, p.y - sy) <= thresh) {
          return true;
        }
      }
      return false;
    }

    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const rad = -((layer.rotation || 0) * Math.PI) / 180;

    const dx = sx - cx;
    const dy = sy - cy;
    const unrotX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const unrotY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

    const padding = layer.type === 'arrow' || layer.type === 'line' ? 8 / scale : 0;
    return (
      unrotX >= layer.x - padding &&
      unrotX <= layer.x + layer.width + padding &&
      unrotY >= layer.y - padding &&
      unrotY <= layer.y + layer.height + padding
    );
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'view' || e.button !== 0 || pointerId.current !== null) return;
    if (workspace) e.currentTarget.focus({ preventScroll: true });
    pointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x: sx, y: sy } = getCanvasCoords(e);

    // CROP MODE
    if (mode === 'crop' && cropRect && onCropChange) {
      const hitRadius = 20 / scale;
      // Handles: nw, ne, se, sw
      if (Math.hypot(sx - cropRect.x, sy - cropRect.y) <= hitRadius) {
        dragActionRef.current = { type: 'crop-resize', handle: 'nw', startX: sx, startY: sy, origRect: { ...cropRect } };
        return;
      }
      if (Math.hypot(sx - (cropRect.x + cropRect.width), sy - cropRect.y) <= hitRadius) {
        dragActionRef.current = { type: 'crop-resize', handle: 'ne', startX: sx, startY: sy, origRect: { ...cropRect } };
        return;
      }
      if (Math.hypot(sx - (cropRect.x + cropRect.width), sy - (cropRect.y + cropRect.height)) <= hitRadius) {
        dragActionRef.current = { type: 'crop-resize', handle: 'se', startX: sx, startY: sy, origRect: { ...cropRect } };
        return;
      }
      if (Math.hypot(sx - cropRect.x, sy - (cropRect.y + cropRect.height)) <= hitRadius) {
        dragActionRef.current = { type: 'crop-resize', handle: 'sw', startX: sx, startY: sy, origRect: { ...cropRect } };
        return;
      }
      // Inside crop rect: move
      if (sx >= cropRect.x && sx <= cropRect.x + cropRect.width && sy >= cropRect.y && sy <= cropRect.y + cropRect.height) {
        dragActionRef.current = { type: 'crop-move', startX: sx, startY: sy, origRect: { ...cropRect } };
        return;
      }
      return;
    }

    // DRAW MODE
    if (mode === 'draw' && drawConfig) {
      const newPathId = `path-${Date.now()}-${nextLayer.current++}`;
      const newPathLayer: PathLayer = {
        id: newPathId,
        type: 'path',
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
        points: [{ x: sx, y: sy }],
        stroke: drawConfig.stroke,
        strokeWidth: drawConfig.strokeWidth,
        isEraser: drawConfig.isEraser,
        isHighlighter: drawConfig.isHighlighter,
        opacity: 1,
      };

      dragActionRef.current = { type: 'draw', layer: newPathLayer };
      setDraftLayer(newPathLayer);
      return;
    }

    // SHAPE CREATE MODE
    if (mode === 'shape' && shapeConfig) {
      dragActionRef.current = { type: 'create-shape', startX: sx, startY: sy, shape: shapeConfig };
      return;
    }

    // SELECT / TRANSFORM MODE
    if (mode === 'select') {
      // 1. Check if hit active layer handle
      if (selectedLayerId) {
        const activeLayer = doc.layers.find((l) => l.id === selectedLayerId);
        if (activeLayer && activeLayer.type !== 'path') {
          const handle = hitTestHandle(activeLayer, sx, sy);
          if (handle) {
            if (handle === 'rot') {
              const cx = activeLayer.x + activeLayer.width / 2;
              const cy = activeLayer.y + activeLayer.height / 2;
              const startAngle = Math.atan2(sy - cy, sx - cx);
              dragActionRef.current = {
                type: 'rotate',
                layerId: activeLayer.id,
                centerX: cx,
                centerY: cy,
                origRotation: activeLayer.rotation || 0,
                startAngle,
              };
            } else {
              dragActionRef.current = {
                type: 'resize',
                layerId: activeLayer.id,
                handle,
                startX: sx,
                startY: sy,
                origX: activeLayer.x,
                origY: activeLayer.y,
                origW: activeLayer.width,
                origH: activeLayer.height,
                rotation: activeLayer.rotation ?? 0,
              };
            }
            return;
          }
        }
      }

      // 2. Check if hit any layer (top to bottom)
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const layer = doc.layers[i];
        if (hitTestLayer(layer, sx, sy)) {
          onSelectLayer(layer.id);
          dragActionRef.current = {
            type: 'move',
            layerId: layer.id,
            startX: sx,
            startY: sy,
            origLayerX: layer.x,
            origLayerY: layer.y,
            origPoints: layer.type === 'path' ? layer.points.map((p) => ({ ...p })) : undefined,
          };
          return;
        }
      }

      // 3. Clicked empty space
      onSelectLayer(null);
    }
  };

  const getShapeLayer = (action: Extract<DragAction, { type: 'create-shape' }>, x: number, y: number): Layer | null => {
    if (workspace) {
      x = Math.max(0, Math.min(doc.width, x));
      y = Math.max(0, Math.min(doc.height, y));
    }
    const { startX, startY, shape } = action;
    const dx = x - startX;
    const dy = y - startY;
    const distance = Math.hypot(dx, dy);
    if (workspace && distance * scale < 3) return null;

    const id = 'shape-gesture';
    if (shape.type === 'arrow' || shape.type === 'line') {
      const width = workspace ? distance : Math.max(20, distance);
      const height = Math.max(1, shape.strokeWidth * 3);
      return {
        id,
        type: shape.type,
        x: (startX + x - width) / 2,
        y: (startY + y - height) / 2,
        width,
        height,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
      };
    }

    const bounds = {
      id,
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      width: Math.max(workspace ? 1 : 20, Math.abs(dx)),
      height: Math.max(workspace ? 1 : 20, Math.abs(dy)),
    };
    if (shape.type === 'redact') {
      return { ...bounds, type: 'redact', redactType: shape.redactType ?? 'pixelate' };
    }
    return { ...bounds, type: shape.type, stroke: shape.stroke, strokeWidth: shape.strokeWidth, fill: shape.fill };
  };

  const changeLayer = (action: Extract<DragAction, { layerId: string }>, sx: number, sy: number): Layer | null => {
    const layer = doc.layers.find((item) => item.id === action.layerId);
    if (!layer) return null;

    if (action.type === 'rotate') {
      const angle = Math.atan2(sy - action.centerY, sx - action.centerX);
      const rotation = Math.round((action.origRotation + ((angle - action.startAngle) * 180) / Math.PI) % 360);
      return rotation === (layer.rotation ?? 0) ? null : { ...layer, rotation };
    }

    const dx = sx - action.startX;
    const dy = sy - action.startY;
    if (dx === 0 && dy === 0) return null;

    if (action.type === 'move') {
      if (layer.type === 'path' && action.origPoints) {
        return { ...layer, points: action.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      }
      return { ...layer, x: action.origLayerX + dx, y: action.origLayerY + dy };
    }

    // Resize in layer coordinates and keep the opposite corner fixed on the image.
    const angle = (action.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const signX = action.handle.endsWith('w') ? -1 : 1;
    const signY = action.handle.startsWith('n') ? -1 : 1;
    const width = Math.max(Math.min(16, action.origW), action.origW + signX * (dx * cos + dy * sin));
    const height = Math.max(Math.min(16, action.origH), action.origH + signY * (dy * cos - dx * sin));
    const shiftX = (signX * (width - action.origW)) / 2;
    const shiftY = (signY * (height - action.origH)) / 2;
    return {
      ...layer,
      x: action.origX + (action.origW - width) / 2 + shiftX * cos - shiftY * sin,
      y: action.origY + (action.origH - height) / 2 + shiftX * sin + shiftY * cos,
      width,
      height,
    };
  };

  const updateCrop = (action: Extract<DragAction, { origRect: CropRect }>, sx: number, sy: number) => {
    if (!onCropChange) return;
    const dx = Math.round(sx - action.startX);
    const dy = Math.round(sy - action.startY);
    const orig = action.origRect;
    if (action.type === 'crop-move') {
      onCropChange({
        ...orig,
        x: Math.max(0, Math.min(doc.width - orig.width, orig.x + dx)),
        y: Math.max(0, Math.min(doc.height - orig.height, orig.y + dy)),
      });
      return;
    }

    const minWidth = Math.min(orig.width, 20);
    const minHeight = Math.min(orig.height, 20);
    const right = orig.x + orig.width;
    const bottom = orig.y + orig.height;
    const leftEdge = action.handle.endsWith('w');
    const topEdge = action.handle.startsWith('n');
    const x = leftEdge ? Math.max(0, Math.min(right - minWidth, orig.x + dx)) : orig.x;
    const y = topEdge ? Math.max(0, Math.min(bottom - minHeight, orig.y + dy)) : orig.y;
    onCropChange({
      x,
      y,
      width: leftEdge ? right - x : Math.max(minWidth, Math.min(doc.width - x, orig.width + dx)),
      height: topEdge ? bottom - y : Math.max(minHeight, Math.min(doc.height - y, orig.height + dy)),
    });
  };

  const appendPoint = (layer: PathLayer, x: number, y: number) => {
    const previous = layer.points.at(-1);
    if (previous?.x !== x || previous.y !== y) layer.points.push({ x, y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const action = dragActionRef.current;
    if (!action || pointerId.current !== e.pointerId) return;

    const { x, y } = getCanvasCoords(e);
    if (action.type === 'crop-move' || action.type === 'crop-resize') {
      updateCrop(action, x, y);
    } else if (action.type === 'draw') {
      appendPoint(action.layer, x, y);
      setDraftLayer({ ...action.layer });
    } else if (action.type === 'create-shape') {
      setDraftLayer(getShapeLayer(action, x, y));
    } else {
      setDraftLayer(changeLayer(action, x, y));
    }
  };

  const clearGesture = () => {
    pointerId.current = null;
    dragActionRef.current = null;
    setDraftLayer(null);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== e.pointerId) return;
    const action = dragActionRef.current;
    clearGesture();
    if (!action) return;

    const { x, y } = getCanvasCoords(e);
    if (action.type === 'crop-move' || action.type === 'crop-resize') {
      updateCrop(action, x, y);
      return;
    }

    let layer: Layer | null;
    if (action.type === 'draw') {
      appendPoint(action.layer, x, y);
      layer = action.layer;
    } else if (action.type === 'create-shape') {
      const shape = getShapeLayer(action, x, y);
      if (!shape) return;
      layer = { ...shape, id: `shape-${Date.now()}-${nextLayer.current++}` };
      onSelectLayer(layer.id);
    } else {
      layer = changeLayer(action, x, y);
    }
    if (!layer) return;

    const layers = doc.layers.some((item) => item.id === layer.id)
      ? doc.layers.map((item) => (item.id === layer.id ? layer : item))
      : [...doc.layers, layer];
    onPushDoc({ ...doc, layers });
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== e.pointerId) return;
    const action = dragActionRef.current;
    if (action?.type === 'crop-resize' || action?.type === 'crop-move') onCropChange?.(action.origRect);
    clearGesture();
  };

  const handleCanvasKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (mode !== 'select' || e.altKey || e.ctrlKey || e.metaKey) return;
    const layer = doc.layers.find((item) => item.id === selectedLayerId);
    const dx = Number(e.key === 'ArrowRight') - Number(e.key === 'ArrowLeft');
    const dy = Number(e.key === 'ArrowDown') - Number(e.key === 'ArrowUp');
    if (!layer || (!dx && !dy)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const moved =
      layer.type === 'path'
        ? { ...layer, points: layer.points.map((p) => ({ x: p.x + dx * step, y: p.y + dy * step })) }
        : { ...layer, x: layer.x + dx * step, y: layer.y + dy * step };
    onPushDoc({ ...doc, layers: doc.layers.map((item) => (item.id === layer.id ? moved : item)) });
  };

  // Keyboard listener for Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId && onDeleteLayer) {
        e.preventDefault();
        onDeleteLayer(selectedLayerId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLayerId, onDeleteLayer]);

  const getCursorClass = () => {
    if (mode === 'draw') return styles.modeDraw;
    if (mode === 'shape') return styles.modeShape;
    return '';
  };

  const canvas = (
    <canvas
      ref={canvasRef}
      data-testid="canvas-stage"
      role="img"
      aria-label={t(
        workspace && mode === 'select'
          ? 'Editing canvas. Arrow keys move the selected layer by one pixel. Hold Shift to move by ten. Delete removes the selected layer.'
          : 'Editing canvas',
      )}
      className={`${styles.canvasElement} ${getCursorClass()} ${rotationPreview ? styles.rotatingCanvas : ''}`}
      tabIndex={workspace ? 0 : undefined}
      width={doc.width}
      height={doc.height}
      style={{
        width: `${Math.max(1, doc.width * displayScale)}px`,
        height: `${Math.max(1, doc.height * displayScale)}px`,
        transform: rotationPreview ? `translate(-50%, -50%) rotate(${rotationPreview.delta}deg)` : undefined,
      }}
      onKeyDown={workspace ? handleCanvasKey : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    />
  );

  if (workspace) {
    return (
      <div className={styles.workspace}>
        <div
          ref={containerRef}
          className={styles.workspaceFrame}
          style={{ '--image-ratio': doc.height / doc.width } as React.CSSProperties}
        >
          <div ref={scrollRef} className={styles.workspaceScroll}>
            <div className={styles.workspaceCanvas}>
              <div
                className={styles.imageFrame}
                style={{ width: Math.max(1, width * displayScale), height: Math.max(1, height * displayScale) }}
              >
                {canvas}
                {rotationPreview && <div className={styles.straightenGrid} aria-hidden="true" />}
              </div>
            </div>
          </div>
        </div>
        <footer className={styles.workspaceFooter}>
          <span>
            {width} × {height} px
          </span>
          <div className={styles.zoomControls} role="group" aria-label={t('Canvas zoom')}>
            <button
              type="button"
              aria-label={t('Zoom out')}
              title={t('Zoom out')}
              disabled={zoomStep <= -2}
              onClick={() => setZoomStep(zoomStep - 1)}
            >
              <Minus aria-hidden="true" />
            </button>
            <output aria-live="polite">{Math.max(1, Math.round(scale * 100))}%</output>
            <button
              type="button"
              aria-label={t('Zoom in')}
              title={t('Zoom in')}
              disabled={zoomStep >= 8}
              onClick={() => setZoomStep(zoomStep + 1)}
            >
              <Plus aria-hidden="true" />
            </button>
            <button type="button" aria-label={t('Fit to view')} title={t('Fit to view')} onClick={() => setZoomStep(0)}>
              <Maximize aria-hidden="true" />
              {t('Fit')}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.stageWrapper}>
      <div className={styles.stageViewport}>{canvas}</div>
      <div className={styles.stageInfo}>
        {doc.width} × {doc.height} px ({Math.round(scale * 100)}%)
      </div>
    </div>
  );
}
