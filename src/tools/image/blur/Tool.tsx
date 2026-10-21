import React, { useState } from 'react';
import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider, Button } from '../../../components/Controls';

export interface BlurRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'blur' | 'pixelate' | 'solid';
  amount: number;
  color?: string;
}

interface BlurOptions {
  mode: 'whole' | 'regions';
  wholeBlur: number;
  regionType: 'blur' | 'pixelate' | 'solid';
  regionAmount: number;
  solidColor: string;
  regions: BlurRegion[];
}

const DEFAULT_OPTIONS: BlurOptions = {
  mode: 'whole',
  wholeBlur: 12,
  regionType: 'blur',
  regionAmount: 16,
  solidColor: '#000000',
  regions: [],
};

function renderBlur(source: HTMLCanvasElement, options: BlurOptions, isPreview: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  // Scale factor relative to 1200px preview width for consistent visual radius
  const scaleRatio = isPreview ? 1 : canvas.width / Math.min(1200, canvas.width);

  if (options.mode === 'whole') {
    if (options.wholeBlur > 0) {
      const radius = Math.round(options.wholeBlur * scaleRatio);
      ctx.filter = `blur(${radius}px)`;
    } else {
      ctx.filter = 'none';
    }
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  // Region mode: draw base image clean
  ctx.drawImage(source, 0, 0);

  for (const reg of options.regions) {
    const rx = Math.round(reg.x * canvas.width);
    const ry = Math.round(reg.y * canvas.height);
    const rw = Math.round(reg.w * canvas.width);
    const rh = Math.round(reg.h * canvas.height);
    if (rw <= 0 || rh <= 0) continue;

    if (reg.type === 'blur') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      const r = Math.max(1, Math.round(reg.amount * scaleRatio));
      ctx.filter = `blur(${r}px)`;
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    } else if (reg.type === 'pixelate') {
      // Pixelate
      const pixelSize = Math.max(2, Math.round(reg.amount * scaleRatio));
      const smallW = Math.max(1, Math.round(rw / pixelSize));
      const smallH = Math.max(1, Math.round(rh / pixelSize));

      const off = document.createElement('canvas');
      off.width = smallW;
      off.height = smallH;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(source, rx, ry, rw, rh, 0, 0, smallW, smallH);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, smallW, smallH, rx, ry, rw, rh);
        ctx.restore();
      }
    } else if (reg.type === 'solid') {
      // Solid redaction: permanently burn opaque rectangle into fresh exported canvas
      ctx.save();
      ctx.fillStyle = reg.color || options.solidColor || '#000000';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }

  return canvas;
}

export default function BlurTool() {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  return (
    <FilterEditorShell<BlurOptions>
      toolId="img-blur"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-blurred"
      render={renderBlur}
      renderOverlay={(options, setOptions, { previewWidth, previewHeight }) => {
        if (options.mode !== 'regions') return null;

        const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / previewWidth));
          const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / previewHeight));
          setDragStart({ x, y });
          setDragCurrent({ x, y });
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        };

        const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!dragStart) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / previewWidth));
          const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / previewHeight));
          setDragCurrent({ x, y });
        };

        const handlePointerUp = () => {
          if (!dragStart || !dragCurrent) {
            setDragStart(null);
            setDragCurrent(null);
            return;
          }

          const x0 = Math.min(dragStart.x, dragCurrent.x);
          const y0 = Math.min(dragStart.y, dragCurrent.y);
          const w = Math.abs(dragCurrent.x - dragStart.x);
          const h = Math.abs(dragCurrent.y - dragStart.y);

          if (w > 0.01 && h > 0.01) {
            const newRegion: BlurRegion = {
              id: 'reg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              x: x0,
              y: y0,
              w,
              h,
              type: options.regionType,
              amount: options.regionAmount,
              color: options.regionType === 'solid' ? options.solidColor : undefined,
            };
            setOptions((prev) => ({
              ...prev,
              regions: [...prev.regions, newRegion],
            }));
          }

          setDragStart(null);
          setDragCurrent(null);
        };

        let draggingBox = null;
        if (dragStart && dragCurrent) {
          const left = Math.min(dragStart.x, dragCurrent.x) * 100;
          const top = Math.min(dragStart.y, dragCurrent.y) * 100;
          const width = Math.abs(dragCurrent.x - dragStart.x) * 100;
          const height = Math.abs(dragCurrent.y - dragStart.y) * 100;

          draggingBox = (
            <div
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                border: '2px dashed #6366f1',
                backgroundColor: options.regionType === 'solid' ? options.solidColor : 'rgba(99, 102, 241, 0.2)',
                opacity: options.regionType === 'solid' ? 0.85 : 1,
                pointerEvents: 'none',
              }}
            />
          );
        }

        return (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              cursor: 'crosshair',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {draggingBox}
            {options.regions.map((reg, idx) => (
              <div
                key={reg.id}
                style={{
                  position: 'absolute',
                  left: `${reg.x * 100}%`,
                  top: `${reg.y * 100}%`,
                  width: `${reg.w * 100}%`,
                  height: `${reg.h * 100}%`,
                  border: reg.type === 'solid' ? '1px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.7)',
                  backgroundColor: reg.type === 'solid' ? reg.color || options.solidColor || '#000000' : 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  padding: '2px',
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    padding: '1px 4px',
                    borderRadius: '2px',
                  }}
                >
                  #{idx + 1} {reg.type}
                </span>
              </div>
            ))}
          </div>
        );
      }}
      renderControls={(options, setOptions) => {
        const removeRegion = (id: string) => {
          setOptions((prev) => ({
            ...prev,
            regions: prev.regions.filter((r) => r.id !== id),
          }));
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Field label="Blur mode">
              <Select
                value={options.mode}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    mode: e.target.value as 'whole' | 'regions',
                  }))
                }
                options={[
                  { value: 'whole', label: 'Whole image blur' },
                  { value: 'regions', label: 'Blur selected regions (censor / privacy)' },
                ]}
              />
            </Field>

            {options.mode === 'whole' ? (
              <Field label={`Blur radius (${options.wholeBlur}px)`}>
                <Slider
                  value={options.wholeBlur}
                  min={1}
                  max={50}
                  step={1}
                  unit="px"
                  onChange={(v) => setOptions((prev) => ({ ...prev, wholeBlur: v }))}
                />
              </Field>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <Field label="Region effect">
                    <Select
                      value={options.regionType}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          regionType: e.target.value as 'blur' | 'pixelate' | 'solid',
                        }))
                      }
                      options={[
                        { value: 'blur', label: 'Gaussian Blur' },
                        { value: 'pixelate', label: 'Pixelate / Mosaic' },
                        { value: 'solid', label: 'Solid Redaction (Opaque Box)' },
                      ]}
                    />
                  </Field>

                  {options.regionType === 'solid' ? (
                    <Field label="Redaction color">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                          type="color"
                          value={options.solidColor}
                          onChange={(e) =>
                            setOptions((prev) => ({
                              ...prev,
                              solidColor: e.target.value,
                            }))
                          }
                          style={{
                            width: '42px',
                            height: '38px',
                            padding: '2px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            background: 'none',
                          }}
                        />
                        <Select
                          value={options.solidColor}
                          onChange={(e) =>
                            setOptions((prev) => ({
                              ...prev,
                              solidColor: e.target.value,
                            }))
                          }
                          options={[
                            { value: '#000000', label: 'Black (#000000)' },
                            { value: '#ffffff', label: 'White (#ffffff)' },
                            { value: '#ef4444', label: 'Red (#ef4444)' },
                            { value: options.solidColor, label: `Custom (${options.solidColor})` },
                          ]}
                        />
                      </div>
                    </Field>
                  ) : (
                    <Field label={`Effect strength (${options.regionAmount})`}>
                      <Slider
                        value={options.regionAmount}
                        min={4}
                        max={40}
                        step={1}
                        unit="px"
                        onChange={(v) => setOptions((prev) => ({ ...prev, regionAmount: v }))}
                      />
                    </Field>
                  )}
                </div>

                <div
                  style={{
                    padding: '0.85rem 1rem',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    fontSize: '0.86rem',
                    lineHeight: '1.45',
                  }}
                >
                  💡 <strong>How to censor regions:</strong> Click and drag on the image above to draw rectangles over areas you want to
                  censor.
                  <div style={{ marginTop: '0.4rem' }}>
                    🔒 <strong>Solid mode for sensitive data:</strong> Standard blur or pixelation can sometimes be partially reconstructed
                    or unblurred by computer vision tools. Solid redaction permanently burns 100% opaque color rectangles into the fresh
                    exported image pixels, ensuring sensitive data (passwords, credit cards, PII) cannot be recovered.
                  </div>
                </div>

                {options.regions.length > 0 && (
                  <div>
                    <label className="field-label">Active regions ({options.regions.length})</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {options.regions.map((reg, idx) => (
                        <div
                          key={reg.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.75rem',
                            background: 'var(--surface)',
                            borderRadius: '6px',
                          }}
                        >
                          <span style={{ fontSize: '0.9rem' }}>
                            Region #{idx + 1} &mdash; <strong>{reg.type}</strong>{' '}
                            {reg.type === 'solid' ? `(${reg.color || options.solidColor})` : `(${reg.amount}px)`}
                          </span>
                          <Button
                            variant="secondary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={() => removeRegion(reg.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
