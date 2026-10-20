import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Slider } from '../../../components/Controls';
import styles from '../_filters/FilterEditorShell.module.css';

interface AdjustOptions {
  brightness: number;
  contrast: number;
  saturation: number;
  hueRotate: number;
  exposure: number;
  warmth: number;
}

const DEFAULT_OPTIONS: AdjustOptions = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hueRotate: 0,
  exposure: 0,
  warmth: 0,
};

function renderAdjust(source: HTMLCanvasElement, options: AdjustOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const b = 100 + options.brightness;
  const c = 100 + options.contrast;
  const s = 100 + options.saturation;
  const h = options.hueRotate;

  ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) hue-rotate(${h}deg)`;
  ctx.drawImage(source, 0, 0);

  if (options.exposure !== 0 || options.warmth !== 0) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const gamma = Math.pow(2, -options.exposure / 50);
    const warmth = options.warmth;

    const lutR = new Uint8Array(256);
    const lutG = new Uint8Array(256);
    const lutB = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      const gVal = 255 * Math.pow(i / 255, gamma);
      lutR[i] = Math.min(255, Math.max(0, Math.round(gVal + warmth * 0.4)));
      lutG[i] = Math.min(255, Math.max(0, Math.round(gVal + warmth * 0.1)));
      lutB[i] = Math.min(255, Math.max(0, Math.round(gVal - warmth * 0.4)));
    }

    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lutR[data[i]];
      data[i + 1] = lutG[data[i + 1]];
      data[i + 2] = lutB[data[i + 2]];
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return canvas;
}

export default function AdjustTool() {
  return (
    <FilterEditorShell<AdjustOptions>
      toolId="img-adjust"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-adjusted"
      render={renderAdjust}
      renderControls={(options, setOptions) => {
        const update = (key: keyof AdjustOptions, val: number) => {
          setOptions((prev) => ({ ...prev, [key]: val }));
        };

        const renderSlider = (
          label: string,
          key: keyof AdjustOptions,
          min: number,
          max: number,
          unit: string = ''
        ) => (
          <div className={styles.sliderWithReset}>
            <div className={styles.sliderHeader}>
              <span className="field-label" style={{ marginBottom: 0 }}>
                {label}
              </span>
              {options[key] !== DEFAULT_OPTIONS[key] && (
                <button
                  type="button"
                  className={styles.resetMiniBtn}
                  onClick={() => update(key, DEFAULT_OPTIONS[key])}
                >
                  Reset
                </button>
              )}
            </div>
            <Slider
              value={options[key]}
              min={min}
              max={max}
              step={1}
              unit={unit}
              onChange={(v) => update(key, v)}
            />
          </div>
        );

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
            {renderSlider('Brightness', 'brightness', -100, 100, '%')}
            {renderSlider('Contrast', 'contrast', -100, 100, '%')}
            {renderSlider('Saturation', 'saturation', -100, 100, '%')}
            {renderSlider('Hue rotate', 'hueRotate', -180, 180, '°')}
            {renderSlider('Exposure (gamma)', 'exposure', -100, 100, '')}
            {renderSlider('Warmth (temperature)', 'warmth', -100, 100, '')}
          </div>
        );
      }}
    />
  );
}
