import { useRef } from 'react';
import styles from './CropArea.module.css';
import { useI18n } from '../../../lib/i18n';

/** Distance of the crop edges from each page edge, as a fraction (0 to 1) of the page side. */
export interface Frac {
  l: number;
  t: number;
  r: number;
  b: number;
}

type Mode = 'new' | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  mode: Mode;
  startX: number;
  startY: number;
  orig: Frac;
}

const MIN = 0.02;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function drag(state: DragState, x: number, y: number): Frac {
  const { mode, orig } = state;
  const dx = x - state.startX;
  const dy = y - state.startY;

  if (mode === 'new') {
    const x0 = Math.min(state.startX, x);
    const x1 = Math.max(state.startX, x);
    const y0 = Math.min(state.startY, y);
    const y1 = Math.max(state.startY, y);
    if (x1 - x0 < MIN || y1 - y0 < MIN) return orig;
    return { l: x0, t: y0, r: 1 - x1, b: 1 - y1 };
  }

  if (mode === 'move') {
    const w = 1 - orig.l - orig.r;
    const h = 1 - orig.t - orig.b;
    const l = clamp(orig.l + dx, 0, 1 - w);
    const t = clamp(orig.t + dy, 0, 1 - h);
    return { l, t, r: 1 - l - w, b: 1 - t - h };
  }

  const next = { ...orig };
  if (mode.includes('n')) next.t = clamp(orig.t + dy, 0, 1 - orig.b - MIN);
  if (mode.includes('s')) next.b = clamp(orig.b - dy, 0, 1 - orig.t - MIN);
  if (mode.includes('w')) next.l = clamp(orig.l + dx, 0, 1 - orig.r - MIN);
  if (mode.includes('e')) next.r = clamp(orig.r - dx, 0, 1 - orig.l - MIN);
  return next;
}

const HANDLES: Exclude<Mode, 'new' | 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_LABELS: Record<Exclude<Mode, 'new' | 'move'>, string> = {
  nw: 'top-left',
  n: 'Top',
  ne: 'top-right',
  e: 'Right',
  se: 'bottom-right',
  s: 'Bottom',
  sw: 'bottom-left',
  w: 'Left',
};

export interface CropAreaProps {
  src: string | null;
  error?: boolean;
  /** Page width divided by page height. */
  aspect: number;
  frac: Frac;
  onChange: (frac: Frac) => void;
}

export function CropArea({ src, error = false, aspect, frac, onChange }: CropAreaProps) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const state = useRef<DragState | null>(null);

  const point = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const begin = (e: React.PointerEvent, mode: Mode) => {
    e.preventDefault();
    e.stopPropagation();
    const p = point(e);
    state.current = { mode, startX: p.x, startY: p.y, orig: frac };
    boxRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!state.current) return;
    const p = point(e);
    onChange(drag(state.current, p.x, p.y));
  };

  const end = (e: React.PointerEvent) => {
    if (!state.current) return;
    state.current = null;
    if (boxRef.current?.hasPointerCapture(e.pointerId)) boxRef.current.releasePointerCapture(e.pointerId);
  };

  const adjustWithKeyboard = (mode: Mode, e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = (e.shiftKey ? 5 : 1) / 100;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    onChange(drag({ mode, startX: 0, startY: 0, orig: frac }, dx, dy));
  };

  const pct = (v: number) => `${v * 100}%`;
  const active = frac.l > 0 || frac.t > 0 || frac.r > 0 || frac.b > 0;
  const place = { left: pct(frac.l), top: pct(frac.t), right: pct(frac.r), bottom: pct(frac.b) };

  return (
    <div
      ref={boxRef}
      className={styles.box}
      style={{ aspectRatio: String(aspect) }}
      data-testid="crop-area"
      onPointerDown={(e) => begin(e, 'new')}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {error ? (
        <span className={styles.loading} role="alert">
          {t('Could not render the page preview. Try another page or PDF.')}
        </span>
      ) : src ? (
        <img src={src} alt={t('Page preview')} className={styles.img} draggable={false} />
      ) : (
        <span className={styles.loading} role="status">
          {t('Rendering preview…')}
        </span>
      )}

      {active && (
        <>
          <div className={styles.dim}>
            <div className={styles.hole} style={place} />
          </div>

          <div
            className={styles.rect}
            data-testid="crop-rect"
            style={place}
            role="group"
            aria-label={t('Crop selection')}
            onPointerDown={(e) => begin(e, 'move')}
          >
            <button
              type="button"
              className={styles.moveHandle}
              aria-label={t('Move crop area')}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
              onPointerDown={(e) => begin(e, 'move')}
              onKeyDown={(e) => adjustWithKeyboard('move', e)}
            >
              <span aria-hidden="true">↕</span>
            </button>
            {HANDLES.map((h) => (
              <button
                key={h}
                type="button"
                className={`${styles.handle} ${styles[`h_${h}`]}`}
                aria-label={t('Resize crop from {side}', { side: t(HANDLE_LABELS[h]) })}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
                onPointerDown={(e) => begin(e, h)}
                onKeyDown={(e) => adjustWithKeyboard(h, e)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
