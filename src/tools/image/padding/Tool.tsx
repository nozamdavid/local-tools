import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { getFilterExportScale } from '../_filters/common';
import { Field, Select, Slider, Button } from '../../../components/Controls';

export type AspectRatioPreset = 'none' | '1:1' | '4:5' | '16:9' | '9:16';
export type PaddingUnit = 'px' | '%';

interface PaddingOptions {
  preset: AspectRatioPreset;
  uniform: boolean;
  unit: PaddingUnit;
  uniformValue: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  isTransparent: boolean;
  bgColor: string;
}

const DEFAULT_OPTIONS: PaddingOptions = {
  preset: 'none',
  uniform: true,
  unit: 'px',
  uniformValue: 40,
  top: 40,
  right: 40,
  bottom: 40,
  left: 40,
  isTransparent: true,
  bgColor: '#ffffff',
};

const PRESET_RATIOS: Record<Exclude<AspectRatioPreset, 'none'>, number> = {
  '1:1': 1 / 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

function renderPadding(source: HTMLCanvasElement, options: PaddingOptions, isPreview: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const w = source.width;
  const h = source.height;

  let padTop: number;
  let padBottom: number;
  let padLeft: number;
  let padRight: number;

  if (options.preset !== 'none') {
    const targetRatio = PRESET_RATIOS[options.preset];
    const currentRatio = w / h;

    if (currentRatio < targetRatio) {
      // Image is narrower than target: add horizontal padding
      const newW = Math.round(h * targetRatio);
      const totalPadX = newW - w;
      padLeft = Math.floor(totalPadX / 2);
      padRight = totalPadX - padLeft;
      padTop = 0;
      padBottom = 0;
    } else {
      // Image is wider than target: add vertical padding
      const newH = Math.round(w / targetRatio);
      const totalPadY = newH - h;
      padTop = Math.floor(totalPadY / 2);
      padBottom = totalPadY - padTop;
      padLeft = 0;
      padRight = 0;
    }
  } else {
    const scaleRatio = getFilterExportScale(source, isPreview);

    if (options.unit === '%') {
      const topVal = options.uniform ? options.uniformValue : options.top;
      const bottomVal = options.uniform ? options.uniformValue : options.bottom;
      const leftVal = options.uniform ? options.uniformValue : options.left;
      const rightVal = options.uniform ? options.uniformValue : options.right;

      padTop = Math.round(h * (topVal / 100));
      padBottom = Math.round(h * (bottomVal / 100));
      padLeft = Math.round(w * (leftVal / 100));
      padRight = Math.round(w * (rightVal / 100));
    } else {
      const topVal = options.uniform ? options.uniformValue : options.top;
      const bottomVal = options.uniform ? options.uniformValue : options.bottom;
      const leftVal = options.uniform ? options.uniformValue : options.left;
      const rightVal = options.uniform ? options.uniformValue : options.right;

      padTop = Math.round(topVal * scaleRatio);
      padBottom = Math.round(bottomVal * scaleRatio);
      padLeft = Math.round(leftVal * scaleRatio);
      padRight = Math.round(rightVal * scaleRatio);
    }
  }

  canvas.width = Math.max(1, w + padLeft + padRight);
  canvas.height = Math.max(1, h + padTop + padBottom);

  if (!options.isTransparent) {
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(source, padLeft, padTop);

  return canvas;
}

export default function PaddingTool() {
  return (
    <FilterEditorShell<PaddingOptions>
      toolId="img-padding"
      defaultOptions={DEFAULT_OPTIONS}
      defaultFormat="image/png"
      suffix="-padded"
      render={renderPadding}
      renderControls={(options, setOptions, { t }) => {
        const setPreset = (preset: AspectRatioPreset) => {
          setOptions((prev) => ({
            ...prev,
            preset,
          }));
        };

        const updateCustom = (changes: Partial<PaddingOptions>) => {
          setOptions((prev) => ({
            ...prev,
            preset: 'none',
            ...changes,
          }));
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label className="field-label">{t('Fit to aspect ratio presets')}</label>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <Button
                  variant={options.preset === '1:1' ? 'primary' : 'secondary'}
                  type="button"
                  data-testid="preset-1-1"
                  onClick={() => setPreset('1:1')}
                >
                  {t('1:1 Square')}
                </Button>
                <Button
                  variant={options.preset === '4:5' ? 'primary' : 'secondary'}
                  type="button"
                  data-testid="preset-4-5"
                  onClick={() => setPreset('4:5')}
                >
                  {t('4:5 Portrait')}
                </Button>
                <Button
                  variant={options.preset === '16:9' ? 'primary' : 'secondary'}
                  type="button"
                  data-testid="preset-16-9"
                  onClick={() => setPreset('16:9')}
                >
                  {t('16:9 Widescreen')}
                </Button>
                <Button
                  variant={options.preset === '9:16' ? 'primary' : 'secondary'}
                  type="button"
                  data-testid="preset-9-16"
                  onClick={() => setPreset('9:16')}
                >
                  {t('9:16 Story')}
                </Button>
                {options.preset !== 'none' && (
                  <Button variant="secondary" type="button" onClick={() => setPreset('none')}>
                    {t('Custom padding')}
                  </Button>
                )}
              </div>
            </div>

            {options.preset === 'none' && (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}
              >
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={options.uniform} onChange={(e) => updateCustom({ uniform: e.target.checked })} />
                    <span>{t('Uniform padding (all sides equal)')}</span>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.9rem' }}>{t('Unit')}:</span>
                    <Select
                      value={options.unit}
                      onChange={(e) => updateCustom({ unit: e.target.value as PaddingUnit })}
                      options={[
                        { value: 'px', label: t('Pixels (px)') },
                        { value: '%', label: t('Percentage (%)') },
                      ]}
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>

                {options.uniform ? (
                  <Field label={t('Padding ({value}{unit})', { value: options.uniformValue, unit: options.unit })}>
                    <Slider
                      value={options.uniformValue}
                      min={0}
                      max={options.unit === '%' ? 100 : 300}
                      step={1}
                      unit={options.unit}
                      onChange={(v) => updateCustom({ uniformValue: v })}
                    />
                  </Field>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    <Field label={t('Top ({value}{unit})', { value: options.top, unit: options.unit })}>
                      <Slider
                        value={options.top}
                        min={0}
                        max={options.unit === '%' ? 100 : 300}
                        step={1}
                        unit={options.unit}
                        onChange={(v) => updateCustom({ top: v })}
                      />
                    </Field>
                    <Field label={t('Right ({value}{unit})', { value: options.right, unit: options.unit })}>
                      <Slider
                        value={options.right}
                        min={0}
                        max={options.unit === '%' ? 100 : 300}
                        step={1}
                        unit={options.unit}
                        onChange={(v) => updateCustom({ right: v })}
                      />
                    </Field>
                    <Field label={t('Bottom ({value}{unit})', { value: options.bottom, unit: options.unit })}>
                      <Slider
                        value={options.bottom}
                        min={0}
                        max={options.unit === '%' ? 100 : 300}
                        step={1}
                        unit={options.unit}
                        onChange={(v) => updateCustom({ bottom: v })}
                      />
                    </Field>
                    <Field label={t('Left ({value}{unit})', { value: options.left, unit: options.unit })}>
                      <Slider
                        value={options.left}
                        min={0}
                        max={options.unit === '%' ? 100 : 300}
                        step={1}
                        unit={options.unit}
                        onChange={(v) => updateCustom({ left: v })}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={options.isTransparent}
                    onChange={(e) => setOptions((prev) => ({ ...prev, isTransparent: e.target.checked }))}
                  />
                  <span>{t('Transparent canvas background (PNG)')}</span>
                </label>
              </div>

              {!options.isTransparent && (
                <div style={{ marginTop: '0.75rem', maxWidth: '200px' }}>
                  <Field label={t('Background colour')}>
                    <input
                      type="color"
                      value={options.bgColor}
                      onChange={(e) => setOptions((prev) => ({ ...prev, bgColor: e.target.value }))}
                      style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
