import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider } from '../../../components/Controls';

interface GrayscaleOptions {
  method: 'luminance' | 'average' | 'desaturate';
  amount: number;
  tint: 'none' | 'sepia' | 'duotone';
  duotoneShadow: string;
  duotoneHighlight: string;
}

const DEFAULT_OPTIONS: GrayscaleOptions = {
  method: 'luminance',
  amount: 100,
  tint: 'none',
  duotoneShadow: '#1a103c',
  duotoneHighlight: '#ffe0b2',
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean,
    16,
  );
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function renderGrayscale(source: HTMLCanvasElement, options: GrayscaleOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;
  const factor = options.amount / 100;

  const [sR, sG, sB] = hexToRgb(options.duotoneShadow || '#1a103c');
  const [hR, hG, hB] = hexToRgb(options.duotoneHighlight || '#ffe0b2');

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let gray: number;
    if (options.method === 'luminance') {
      gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    } else if (options.method === 'average') {
      gray = (r + g + b) / 3;
    } else {
      gray = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    }

    let outR = gray;
    let outG = gray;
    let outB = gray;

    if (options.tint === 'sepia') {
      outR = Math.min(255, gray * 1.2);
      outG = Math.min(255, gray * 1.0);
      outB = Math.min(255, gray * 0.8);
    } else if (options.tint === 'duotone') {
      const t = gray / 255;
      outR = sR + t * (hR - sR);
      outG = sG + t * (hG - sG);
      outB = sB + t * (hB - sB);
    }

    data[i] = Math.round(r * (1 - factor) + outR * factor);
    data[i + 1] = Math.round(g * (1 - factor) + outG * factor);
    data[i + 2] = Math.round(b * (1 - factor) + outB * factor);
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export default function GrayscaleTool() {
  return (
    <FilterEditorShell<GrayscaleOptions>
      toolId="img-grayscale"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-grayscale"
      render={renderGrayscale}
      renderControls={(options, setOptions) => {
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            <Field label="Grayscale method">
              <Select
                value={options.method}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    method: e.target.value as 'luminance' | 'average' | 'desaturate',
                  }))
                }
                options={[
                  { value: 'luminance', label: 'Luminance (perceptual, standard)' },
                  { value: 'average', label: 'Average ((R+G+B)/3)' },
                  { value: 'desaturate', label: 'Desaturate (lightness)' },
                ]}
              />
            </Field>

            <Field label={`Grayscale intensity (${options.amount}%)`}>
              <Slider
                value={options.amount}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setOptions((prev) => ({ ...prev, amount: v }))}
              />
            </Field>

            <Field label="Tint / Tone">
              <Select
                value={options.tint}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    tint: e.target.value as 'none' | 'sepia' | 'duotone',
                  }))
                }
                options={[
                  { value: 'none', label: 'None (Pure Black & White)' },
                  { value: 'sepia', label: 'Sepia tone' },
                  { value: 'duotone', label: 'Duotone colours' },
                ]}
              />
            </Field>

            {options.tint === 'duotone' && (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <Field label="Shadow colour">
                  <input
                    type="color"
                    value={options.duotoneShadow}
                    onChange={(e) => setOptions((prev) => ({ ...prev, duotoneShadow: e.target.value }))}
                    style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                  />
                </Field>
                <Field label="Highlight colour">
                  <input
                    type="color"
                    value={options.duotoneHighlight}
                    onChange={(e) => setOptions((prev) => ({ ...prev, duotoneHighlight: e.target.value }))}
                    style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                  />
                </Field>
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
