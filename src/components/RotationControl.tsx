import { useId, useRef, useState, type PointerEvent } from 'react';
import { formatNumber } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Button } from './Controls';
import styles from './RotationControl.module.css';

const min = -180;
const max = 180;
const step = 0.1;
const ticks = Array.from({ length: 73 }, (_, index) => min + index * 5);
const labels = ticks.filter((tick) => tick % 15 === 0);

function position(angle: number) {
  return `${((angle - min) / (max - min)) * 100}%`;
}

export function normalizeRotation(angle: number) {
  const stepped = Math.round(angle * 10) % 3600;
  if (stepped > 1800) return (stepped - 3600) / 10;
  if (stepped < -1800) return (stepped + 3600) / 10;
  return stepped / 10 || 0;
}

export function RotationControl({
  angle,
  onChange,
  onPreview,
  disabled,
}: {
  angle: number;
  onChange: (angle: number) => void;
  onPreview?: (angle: number | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  const [typedAngle, setTypedAngle] = useState<string | null>(null);
  const normalized = normalizeRotation(angle);
  const current = dragAngle ?? normalized;

  function angleAt(event: PointerEvent<HTMLInputElement>) {
    const bounds = track.current!.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return normalizeRotation(min + progress * (max - min));
  }

  function move(event: PointerEvent<HTMLInputElement>) {
    if (pointer.current !== event.pointerId) return;
    const next = angleAt(event);
    setDragAngle(next);
    onPreview?.(next);
  }

  function finish(event: PointerEvent<HTMLInputElement>, commit: boolean) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setDragAngle(null);
    onPreview?.(null);
    if (commit) change(angleAt(event));
  }

  function change(next: number) {
    if (next !== normalized) onChange(next);
  }

  return (
    <div className={styles.control}>
      <div className={styles.header}>
        <label htmlFor={id}>{t('Rotation')}</label>
        <div className={styles.degrees}>
          <input
            className="input"
            type="number"
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={t('Rotation angle (degrees)')}
            value={typedAngle ?? current}
            onChange={(event) => setTypedAngle(event.currentTarget.value)}
            onBlur={(event) => {
              const next = event.currentTarget.valueAsNumber;
              setTypedAngle(null);
              if (Number.isFinite(next)) change(normalizeRotation(next));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape' && typedAngle !== null) {
                event.preventDefault();
                event.currentTarget.value = String(normalized);
                event.currentTarget.blur();
              }
            }}
          />
          <span aria-hidden="true">°</span>
        </div>
        <Button variant="ghost" size="sm" disabled={disabled || current === 0} aria-label={t('Reset rotation')} onClick={() => change(0)}>
          {t('Reset')}
        </Button>
      </div>
      <div className={styles.ruler}>
        <div className={styles.scale} ref={track} aria-hidden="true">
          <div className={styles.labels}>
            {labels.map((label) => (
              <span key={label} style={{ left: position(label) }} data-cardinal={label % 90 === 0} data-thirty={label % 30 === 0}>
                {formatNumber(label)}°
              </span>
            ))}
          </div>
          <div className={styles.ticks}>
            {ticks.map((tick) => (
              <span key={tick} data-major={tick % 15 === 0} data-zero={tick === 0} />
            ))}
          </div>
          <span className={styles.marker} style={{ left: position(current) }} />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={current}
          aria-valuetext={`${formatNumber(current, 1)}°`}
          onChange={(event) => change(event.currentTarget.valueAsNumber)}
          onPointerDown={(event) => {
            if (event.button !== 0 || pointer.current !== null) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = event.pointerId;
            move(event);
          }}
          onPointerMove={move}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
          onLostPointerCapture={(event) => finish(event, false)}
        />
      </div>
    </div>
  );
}
