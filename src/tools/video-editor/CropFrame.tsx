import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../../lib/i18n';
import type { VideoEdit } from './engine';
import styles from './CropFrame.module.css';

type Crop = NonNullable<VideoEdit['crop']>;
type CropFrameProps = {
  video: HTMLVideoElement;
  width: number;
  height: number;
  crop: Crop;
  onChange: (crop: Crop) => void;
};

const grips = ['nw', 'ne', 'sw', 'se'] as const;
type DragMode = 'draw' | 'move' | (typeof grips)[number];
type Point = { x: number; y: number };
type Drag = { id: number; mode: DragMode; frame: HTMLDivElement; start: Point; client: Point; crop: Crop };

function clampPixel(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cropAt(drag: Drag, point: Point, width: number, height: number): Crop {
  const { mode, start, crop } = drag;
  if (mode === 'draw') {
    const startX = clampPixel(start.x, 0, width);
    const startY = clampPixel(start.y, 0, height);
    const endX = clampPixel(point.x, 0, width);
    const endY = clampPixel(point.y, 0, height);
    const x = Math.min(startX, endX, width - 1);
    const y = Math.min(startY, endY, height - 1);
    return { x, y, width: Math.max(1, Math.abs(endX - startX)), height: Math.max(1, Math.abs(endY - startY)) };
  }

  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (mode === 'move') {
    return {
      ...crop,
      x: clampPixel(crop.x + dx, 0, width - crop.width),
      y: clampPixel(crop.y + dy, 0, height - crop.height),
    };
  }

  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const west = mode.endsWith('w');
  const north = mode.startsWith('n');
  const x = west ? clampPixel(crop.x + dx, 0, right - 1) : crop.x;
  const y = north ? clampPixel(crop.y + dy, 0, bottom - 1) : crop.y;
  return {
    x,
    y,
    width: (west ? right : clampPixel(right + dx, x + 1, width)) - x,
    height: (north ? bottom : clampPixel(bottom + dy, y + 1, height)) - y,
  };
}

export function CropFrame({ video, width, height, crop, onChange }: CropFrameProps) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Crop | null>(null);
  const previewScale = Math.min(1, 1280 / Math.max(width, height));
  const canvasWidth = Math.max(1, Math.round(width * previewScale));
  const canvasHeight = Math.max(1, Math.round(height * previewScale));

  useEffect(() => {
    const context = canvas.current?.getContext('2d', { alpha: false });
    if (!context) return;

    function paint() {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking) {
        context?.drawImage(video, 0, 0, canvasWidth, canvasHeight);
      }
    }

    const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function';
    let frame: number | undefined;
    function drawNextFrame() {
      frame = undefined;
      paint();
      schedule();
    }

    function schedule() {
      if (frame !== undefined) return;
      if (hasVideoFrames) frame = video.requestVideoFrameCallback(drawNextFrame);
      else if (!video.paused && !video.ended) frame = requestAnimationFrame(drawNextFrame);
    }

    const paintEvents = ['loadeddata', 'seeked', 'pause', 'ended'];
    for (const event of paintEvents) video.addEventListener(event, paint);
    video.addEventListener('playing', schedule);
    paint();
    schedule();
    return () => {
      for (const event of paintEvents) video.removeEventListener(event, paint);
      video.removeEventListener('playing', schedule);
      if (frame === undefined) return;
      if (hasVideoFrames) video.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
    };
  }, [video, canvasWidth, canvasHeight]);

  function sourcePoint(frame: HTMLDivElement, { clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
    const bounds = frame.getBoundingClientRect();
    return { x: ((clientX - bounds.left) * width) / bounds.width, y: ((clientY - bounds.top) * height) / bounds.height };
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    const mode = ((event.target as HTMLElement).dataset.drag as DragMode | undefined) ?? 'draw';
    const frame = event.currentTarget;
    drag.current = {
      id: event.pointerId,
      mode,
      frame,
      start: sourcePoint(frame, event),
      client: { x: event.clientX, y: event.clientY },
      crop,
    };
    frame.setPointerCapture(event.pointerId);
  }

  const updateDrag = useEffectEvent((event: PointerEvent, commit: boolean) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    // A tap on the frame leaves the crop in place.
    const moved = Math.hypot(event.clientX - active.client.x, event.clientY - active.client.y) >= 3;
    const next = moved ? cropAt(active, sourcePoint(active.frame, event), width, height) : null;
    if (!commit) {
      setDraft(next);
      return;
    }

    drag.current = null;
    setDraft(null);
    if (next && (next.x !== crop.x || next.y !== crop.y || next.width !== crop.width || next.height !== crop.height)) onChange(next);
  });

  useEffect(() => {
    // Keep tracking when a pointer leaves the frame, including when capture is unavailable.
    const move = (event: PointerEvent) => updateDrag(event, false);
    const release = (event: PointerEvent) => updateDrag(event, true);
    function clearDrag() {
      if (!drag.current) return;
      drag.current = null;
      setDraft(null);
    }
    function cancelDrag(event: PointerEvent) {
      if (drag.current?.id === event.pointerId) clearDrag();
    }
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancelDrag, true);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancelDrag, true);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  const selection = draft ?? crop;
  const selectionStyle = {
    left: `${(selection.x / width) * 100}%`,
    top: `${(selection.y / height) * 100}%`,
    width: `${(selection.width / width) * 100}%`,
    height: `${(selection.height / height) * 100}%`,
  };
  const fillsFrame = selection.width === width && selection.height === height;

  return (
    <div className={styles.stage}>
      <div className={styles.frame} style={{ '--aspect': width / height } as CSSProperties} onPointerDown={beginDrag}>
        <canvas ref={canvas} width={canvasWidth} height={canvasHeight} role="img" aria-label={t('Source preview')} />
        <div className={styles.mask} aria-hidden="true">
          <div className={styles.aperture} style={selectionStyle} />
        </div>
        <div className={styles.selection} style={selectionStyle} data-drag={fillsFrame ? undefined : 'move'} aria-hidden="true">
          {grips.map((grip) => (
            <div key={grip} className={`${styles.grip} ${styles[grip]}`} data-drag={grip} />
          ))}
        </div>
      </div>
    </div>
  );
}
