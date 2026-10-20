import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider } from '../../../components/Controls';

export type BorderPreset =
  | 'polaroid'
  | 'film-strip'
  | 'double-line'
  | 'shadowed-mat'
  | 'rounded-card'
  | 'vintage-vignette';

interface BorderOptions {
  preset: BorderPreset;
  color: string;
  scale: number;
}

const DEFAULT_OPTIONS: BorderOptions = {
  preset: 'polaroid',
  color: '#f8f8f6',
  scale: 100,
};

const DEFAULT_COLORS: Record<BorderPreset, string> = {
  polaroid: '#f8f8f6',
  'film-strip': '#18181b',
  'double-line': '#f5f0eb',
  'shadowed-mat': '#fdfcf7',
  'rounded-card': '#0f172a',
  'vintage-vignette': '#292524',
};

function renderDecorativeBorder(
  source: HTMLCanvasElement,
  options: BorderOptions
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const w = source.width;
  const h = source.height;
  const maxDim = Math.max(w, h);
  const minDim = Math.min(w, h);
  const scaleMul = options.scale / 100;
  const col = options.color;

  if (options.preset === 'polaroid') {
    const side = Math.max(10, Math.round(maxDim * 0.05 * scaleMul));
    const bottom = Math.max(25, Math.round(maxDim * 0.18 * scaleMul));

    canvas.width = w + 2 * side;
    canvas.height = h + side + bottom;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(source, side, side);

    // Subtle photo edge stroke
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = Math.max(1, Math.round(side * 0.04));
    ctx.strokeRect(side, side, w, h);
  } else if (options.preset === 'film-strip') {
    const band = Math.max(20, Math.round(h * 0.12 * scaleMul));
    canvas.width = w;
    canvas.height = h + 2 * band;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, band);

    // Sprocket holes
    const holeW = Math.max(6, Math.round(band * 0.4));
    const holeH = Math.max(8, Math.round(band * 0.55));
    const holeR = Math.max(2, Math.round(band * 0.1));
    const step = Math.max(16, Math.round(band * 0.85));

    const drawHoles = (yCenter: number) => {
      ctx.fillStyle = '#e4e4e7';
      for (let x = Math.round(step / 2); x + holeW < w; x += step) {
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, yCenter - holeH / 2, holeW, holeH, holeR);
        } else {
          ctx.rect(x, yCenter - holeH / 2, holeW, holeH);
        }
        ctx.fill();
      }
    };

    drawHoles(band / 2);
    drawHoles(canvas.height - band / 2);
  } else if (options.preset === 'double-line') {
    const margin = Math.max(15, Math.round(maxDim * 0.06 * scaleMul));
    canvas.width = w + 2 * margin;
    canvas.height = h + 2 * margin;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, margin, margin);

    // Outer & inner decorative lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    const lineW = Math.max(1, Math.round(margin * 0.04));
    ctx.lineWidth = lineW;

    const outOffset = Math.round(margin * 0.35);
    ctx.strokeRect(outOffset, outOffset, canvas.width - 2 * outOffset, canvas.height - 2 * outOffset);

    const inOffset = Math.round(margin * 0.65);
    ctx.strokeRect(inOffset, inOffset, canvas.width - 2 * inOffset, canvas.height - 2 * inOffset);
  } else if (options.preset === 'shadowed-mat') {
    const mat = Math.max(20, Math.round(maxDim * 0.08 * scaleMul));
    canvas.width = w + 2 * mat;
    canvas.height = h + 2 * mat;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, mat, mat);

    // Inner bevel shadow around photo window
    const shadowSize = Math.max(4, Math.round(mat * 0.12));
    // Top inner shadow
    const topGrad = ctx.createLinearGradient(mat, mat, mat, mat + shadowSize);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(mat, mat, w, shadowSize);

    // Left inner shadow
    const leftGrad = ctx.createLinearGradient(mat, mat, mat + shadowSize, mat);
    leftGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    leftGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(mat, mat, shadowSize, h);

    // Bottom and right highlight bevel
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = Math.max(1, Math.round(shadowSize * 0.3));
    ctx.beginPath();
    ctx.moveTo(mat, mat + h);
    ctx.lineTo(mat + w, mat + h);
    ctx.lineTo(mat + w, mat);
    ctx.stroke();
  } else if (options.preset === 'rounded-card') {
    const pad = Math.max(16, Math.round(maxDim * 0.06 * scaleMul));
    const cardRadius = Math.max(8, Math.round(minDim * 0.05));
    canvas.width = w + 2 * pad;
    canvas.height = h + 2 * pad;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pad, pad, w, h, cardRadius);
    } else {
      ctx.rect(pad, pad, w, h);
    }
    ctx.clip();
    ctx.drawImage(source, pad, pad);
    ctx.restore();

    // Card border outline
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = Math.max(1, Math.round(pad * 0.04));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pad, pad, w, h, cardRadius);
    } else {
      ctx.rect(pad, pad, w, h);
    }
    ctx.stroke();
  } else if (options.preset === 'vintage-vignette') {
    const pad = Math.max(10, Math.round(maxDim * 0.03 * scaleMul));
    canvas.width = w + 2 * pad;
    canvas.height = h + 2 * pad;

    ctx.fillStyle = col;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, pad, pad);

    // Vignette
    const cx = pad + w / 2;
    const cy = pad + h / 2;
    const radius = Math.max(w, h) * 0.65;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(20,10,5,0.4)');
    grad.addColorStop(1, 'rgba(10,5,2,0.85)');

    ctx.fillStyle = grad;
    ctx.fillRect(pad, pad, w, h);

    // Weathered border
    ctx.strokeStyle = 'rgba(235, 200, 150, 0.3)';
    ctx.lineWidth = Math.max(1, Math.round(pad * 0.2));
    ctx.strokeRect(pad, pad, w, h);
  }

  return canvas;
}

export default function BorderTool() {
  return (
    <FilterEditorShell<BorderOptions>
      toolId="img-border"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-border"
      render={renderDecorativeBorder}
      renderControls={(options, setOptions) => {
        const handlePresetChange = (preset: BorderPreset) => {
          setOptions((prev) => ({
            ...prev,
            preset,
            color: DEFAULT_COLORS[preset] || prev.color,
          }));
        };

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            <Field label="Frame preset">
              <Select
                value={options.preset}
                onChange={(e) => handlePresetChange(e.target.value as BorderPreset)}
                options={[
                  { value: 'polaroid', label: '📸 Polaroid classic' },
                  { value: 'film-strip', label: '🎞️ 35mm Film strip' },
                  { value: 'double-line', label: '🏛️ Double line elegant' },
                  { value: 'shadowed-mat', label: '🖼️ Gallery picture mat' },
                  { value: 'rounded-card', label: '💳 Modern rounded card' },
                  { value: 'vintage-vignette', label: '🕰️ Vintage vignette' },
                ]}
              />
            </Field>

            <Field label="Frame colour">
              <input
                type="color"
                value={options.color}
                onChange={(e) =>
                  setOptions((prev) => ({ ...prev, color: e.target.value }))
                }
                style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
              />
            </Field>

            <Field label={`Border scale (${options.scale}%)`}>
              <Slider
                value={options.scale}
                min={50}
                max={200}
                step={5}
                unit="%"
                onChange={(v) => setOptions((prev) => ({ ...prev, scale: v }))}
              />
            </Field>
          </div>
        );
      }}
    />
  );
}
