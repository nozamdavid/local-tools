import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CanvasDocument, Layer, TransformHandle, PathLayer } from './types';
import { renderDocument } from './render';
import styles from './CanvasStage.module.css';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StageMode = 'select' | 'draw' | 'shape' | 'crop';

export interface ShapeConfig {
  type: 'rect' | 'ellipse' | 'arrow' | 'line' | 'redact';
  stroke: string;
  strokeWidth: number;
  fill?: string;
  redactType?: 'blur' | 'pixelate';
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
  onCropChange?: (rect: CropRect) => void;
  onSelectLayer: (layerId: string | null) => void;
  onUpdateDocSilent: (updater: (prev: CanvasDocument) => CanvasDocument) => void;
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
    }
  | { type: 'rotate'; layerId: string; centerX: number; centerY: number; origRotation: number; startAngle: number }
  | { type: 'draw'; layerId: string }
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
  onCropChange,
  onSelectLayer,
  onUpdateDocSilent,
  onPushDoc,
  onDeleteLayer,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState<number>(1);
  const dragActionRef = useRef<DragAction | null>(null);
  const [isModifiedDuringDrag, setIsModifiedDuringDrag] = useState(false);

  // Resize listener to fit viewport
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const pad = 32;
      const availW = Math.max(100, clientWidth - pad);
      const availH = Math.max(100, (clientHeight || 520) - pad);
      const s = Math.min(availW / doc.width, availH / doc.height, 1);
      setScale(Math.max(0.05, s));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateScale);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [doc.width, doc.height]);

  // Redraw canvas with layers & overlays
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderDocument(ctx, doc, true);

    const handleRadius = 6 / scale;
    const lineWidth = 1.5 / scale;

    // Draw active layer handles
    if (mode === 'select' && selectedLayerId) {
      const layer = doc.layers.find((l) => l.id === selectedLayerId);
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
        ctx.strokeStyle = '#c026d3';
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
        ctx.strokeStyle = '#c026d3';
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
          ctx.strokeStyle = '#c026d3';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(layer.width / 2, rotY, handleRadius * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#c026d3';
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
  }, [doc, selectedLayerId, mode, scale, cropRect]);

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

    return unrotX >= layer.x && unrotX <= layer.x + layer.width && unrotY >= layer.y && unrotY <= layer.y + layer.height;
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x: sx, y: sy } = getCanvasCoords(e);
    setIsModifiedDuringDrag(false);

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
      const newPathId = 'path-' + Date.now();
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

      onUpdateDocSilent((prev) => ({
        ...prev,
        layers: [...prev.layers, newPathLayer],
      }));
      dragActionRef.current = { type: 'draw', layerId: newPathId };
      setIsModifiedDuringDrag(true);
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

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const action = dragActionRef.current;
    if (!action) return;

    const { x: sx, y: sy } = getCanvasCoords(e);
    setIsModifiedDuringDrag(true);

    if (action.type === 'crop-move' && cropRect && onCropChange) {
      const dx = sx - action.startX;
      const dy = sy - action.startY;
      const newX = Math.max(0, Math.min(doc.width - action.origRect.width, action.origRect.x + dx));
      const newY = Math.max(0, Math.min(doc.height - action.origRect.height, action.origRect.y + dy));
      onCropChange({ ...action.origRect, x: Math.round(newX), y: Math.round(newY) });
      return;
    }

    if (action.type === 'crop-resize' && cropRect && onCropChange) {
      const dx = sx - action.startX;
      const dy = sy - action.startY;
      const orig = action.origRect;
      let nx = orig.x;
      let ny = orig.y;
      let nw = orig.width;
      let nh = orig.height;

      if (action.handle === 'se') {
        nw = Math.max(20, orig.width + dx);
        nh = Math.max(20, orig.height + dy);
      } else if (action.handle === 'sw') {
        nx = Math.min(orig.x + orig.width - 20, orig.x + dx);
        nw = orig.width - (nx - orig.x);
        nh = Math.max(20, orig.height + dy);
      } else if (action.handle === 'ne') {
        ny = Math.min(orig.y + orig.height - 20, orig.y + dy);
        nw = Math.max(20, orig.width + dx);
        nh = orig.height - (ny - orig.y);
      } else if (action.handle === 'nw') {
        nx = Math.min(orig.x + orig.width - 20, orig.x + dx);
        ny = Math.min(orig.y + orig.height - 20, orig.y + dy);
        nw = orig.width - (nx - orig.x);
        nh = orig.height - (ny - orig.y);
      }

      onCropChange({
        x: Math.max(0, Math.round(nx)),
        y: Math.max(0, Math.round(ny)),
        width: Math.min(doc.width - nx, Math.round(nw)),
        height: Math.min(doc.height - ny, Math.round(nh)),
      });
      return;
    }

    if (action.type === 'draw') {
      onUpdateDocSilent((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === action.layerId && l.type === 'path' ? { ...l, points: [...l.points, { x: sx, y: sy }] } : l,
        ),
      }));
      return;
    }

    if (action.type === 'create-shape') {
      const x = Math.min(action.startX, sx);
      const y = Math.min(action.startY, sy);
      const w = Math.max(4, Math.abs(sx - action.startX));
      const h = Math.max(4, Math.abs(sy - action.startY));

      // Live preview by rendering or updating
      onUpdateDocSilent((prev) => {
        const filtered = prev.layers.filter((l) => l.id !== 'preview-shape');
        let previewLayer: Layer;

        if (action.shape.type === 'redact') {
          previewLayer = {
            id: 'preview-shape',
            type: 'redact',
            x,
            y,
            width: w,
            height: h,
            redactType: action.shape.redactType || 'pixelate',
          };
        } else if (action.shape.type === 'arrow') {
          const dx = sx - action.startX;
          const dy = sy - action.startY;
          const len = Math.max(10, Math.hypot(dx, dy));
          const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
          previewLayer = {
            id: 'preview-shape',
            type: 'arrow',
            x: action.startX,
            y: action.startY - (action.shape.strokeWidth * 3) / 2,
            width: len,
            height: action.shape.strokeWidth * 3,
            rotation: rot,
            stroke: action.shape.stroke,
            strokeWidth: action.shape.strokeWidth,
          };
        } else if (action.shape.type === 'line') {
          previewLayer = {
            id: 'preview-shape',
            type: 'line',
            x,
            y,
            width: w,
            height: h,
            stroke: action.shape.stroke,
            strokeWidth: action.shape.strokeWidth,
          };
        } else if (action.shape.type === 'ellipse') {
          previewLayer = {
            id: 'preview-shape',
            type: 'ellipse',
            x,
            y,
            width: w,
            height: h,
            stroke: action.shape.stroke,
            strokeWidth: action.shape.strokeWidth,
            fill: action.shape.fill,
          };
        } else {
          previewLayer = {
            id: 'preview-shape',
            type: 'rect',
            x,
            y,
            width: w,
            height: h,
            stroke: action.shape.stroke,
            strokeWidth: action.shape.strokeWidth,
            fill: action.shape.fill,
          };
        }

        return { ...prev, layers: [...filtered, previewLayer] };
      });
      return;
    }

    if (action.type === 'move') {
      const dx = sx - action.startX;
      const dy = sy - action.startY;

      onUpdateDocSilent((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => {
          if (l.id !== action.layerId) return l;
          if (l.type === 'path' && action.origPoints) {
            return {
              ...l,
              points: action.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          return {
            ...l,
            x: Math.round(action.origLayerX + dx),
            y: Math.round(action.origLayerY + dy),
          };
        }),
      }));
      return;
    }

    if (action.type === 'rotate') {
      const currAngle = Math.atan2(sy - action.centerY, sx - action.centerX);
      const angleDelta = ((currAngle - action.startAngle) * 180) / Math.PI;
      const newRotation = Math.round((action.origRotation + angleDelta) % 360);

      onUpdateDocSilent((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === action.layerId ? { ...l, rotation: newRotation } : l)),
      }));
      return;
    }

    if (action.type === 'resize') {
      const dx = sx - action.startX;
      const dy = sy - action.startY;
      const orig = action;

      let nx = orig.origX;
      let ny = orig.origY;
      let nw = orig.origW;
      let nh = orig.origH;

      if (orig.handle === 'se') {
        nw = Math.max(16, orig.origW + dx);
        nh = Math.max(16, orig.origH + dy);
      } else if (orig.handle === 'sw') {
        nx = Math.min(orig.origX + orig.origW - 16, orig.origX + dx);
        nw = orig.origW - (nx - orig.origX);
        nh = Math.max(16, orig.origH + dy);
      } else if (orig.handle === 'ne') {
        ny = Math.min(orig.origY + orig.origH - 16, orig.origY + dy);
        nw = Math.max(16, orig.origW + dx);
        nh = orig.origH - (ny - orig.origY);
      } else if (orig.handle === 'nw') {
        nx = Math.min(orig.origX + orig.origW - 16, orig.origX + dx);
        ny = Math.min(orig.origY + orig.origH - 16, orig.origY + dy);
        nw = orig.origW - (nx - orig.origX);
        nh = orig.origH - (ny - orig.origY);
      }

      onUpdateDocSilent((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === orig.layerId ? { ...l, x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) } : l,
        ),
      }));
    }
  };

  // Pointer Up
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if not captured
    }

    const action = dragActionRef.current;
    dragActionRef.current = null;

    if (action && action.type === 'create-shape') {
      const { x: sx, y: sy } = getCanvasCoords(e);
      const newId = 'shape-' + Date.now();
      const x = Math.min(action.startX, sx);
      const y = Math.min(action.startY, sy);
      const w = Math.max(20, Math.abs(sx - action.startX));
      const h = Math.max(20, Math.abs(sy - action.startY));

      let newLayer: Layer;

      if (action.shape.type === 'redact') {
        newLayer = {
          id: newId,
          type: 'redact',
          x,
          y,
          width: w,
          height: h,
          redactType: action.shape.redactType || 'pixelate',
        };
      } else if (action.shape.type === 'arrow') {
        const dx = sx - action.startX;
        const dy = sy - action.startY;
        const len = Math.max(20, Math.hypot(dx, dy));
        const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
        newLayer = {
          id: newId,
          type: 'arrow',
          x: action.startX,
          y: action.startY - (action.shape.strokeWidth * 3) / 2,
          width: len,
          height: Math.max(16, action.shape.strokeWidth * 3),
          rotation: rot,
          stroke: action.shape.stroke,
          strokeWidth: action.shape.strokeWidth,
        };
      } else if (action.shape.type === 'line') {
        newLayer = {
          id: newId,
          type: 'line',
          x,
          y,
          width: w,
          height: h,
          stroke: action.shape.stroke,
          strokeWidth: action.shape.strokeWidth,
        };
      } else if (action.shape.type === 'ellipse') {
        newLayer = {
          id: newId,
          type: 'ellipse',
          x,
          y,
          width: w,
          height: h,
          stroke: action.shape.stroke,
          strokeWidth: action.shape.strokeWidth,
          fill: action.shape.fill || 'transparent',
        };
      } else {
        newLayer = {
          id: newId,
          type: 'rect',
          x,
          y,
          width: w,
          height: h,
          stroke: action.shape.stroke,
          strokeWidth: action.shape.strokeWidth,
          fill: action.shape.fill || 'transparent',
        };
      }

      const cleanLayers = doc.layers.filter((l) => l.id !== 'preview-shape');
      onPushDoc({
        ...doc,
        layers: [...cleanLayers, newLayer],
      });
      onSelectLayer(newId);
      return;
    }

    if (isModifiedDuringDrag) {
      onPushDoc({ ...doc });
    }
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

  return (
    <div ref={containerRef} className={styles.stageWrapper}>
      <div className={styles.stageViewport}>
        <canvas
          ref={canvasRef}
          data-testid="canvas-stage"
          role="img"
          aria-label="Editing canvas. Placing, moving and resizing layers needs a pointer; the side panel controls and the Delete key edit the selected layer."
          className={`${styles.canvasElement} ${getCursorClass()}`}
          width={doc.width}
          height={doc.height}
          style={{
            width: `${Math.round(doc.width * scale)}px`,
            height: `${Math.round(doc.height * scale)}px`,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
      <div className={styles.stageInfo}>
        {doc.width} × {doc.height} px ({Math.round(scale * 100)}%)
      </div>
    </div>
  );
}
