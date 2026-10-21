import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider } from '../../../components/Controls';

export type BorderStyle = 'solid' | 'gradient' | 'dashed';
export type BorderPosition = 'outside' | 'inside';

interface AddBorderOptions {
  style: BorderStyle;
  color1: string;
  color2: string;
  gradientAngle: number;
  dashLength: number;
  dashGap: number;
  width: number;
  position: BorderPosition;
  radius: number;
}

const DEFAULT_OPTIONS: AddBorderOptions = {
  style: 'solid',
  color1: '#000000',
  color2: '#6366f1',
  gradientAngle: 45,
  dashLength: 20,
  dashGap: 10,
  width: 24,
  position: 'outside',
  radius: 0,
};

function renderAddBorder(source: HTMLCanvasElement, options: AddBorderOptions, isPreview: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const w = source.width;
  const h = source.height;
  const scaleRatio = isPreview ? 1 : canvas.width ? canvas.width / 1200 : source.width / Math.min(1200, source.width);
  const bw = Math.max(1, Math.round(options.width * scaleRatio));
  const r = Math.max(0, Math.round(options.radius * scaleRatio));

  const getStrokeOrFillStyle = (targetW: number, targetH: number) => {
    if (options.style === 'gradient') {
      const rad = (options.gradientAngle * Math.PI) / 180;
      const cx = targetW / 2;
      const cy = targetH / 2;
      const len = Math.max(targetW, targetH) / 2;
      const x0 = cx - Math.cos(rad) * len;
      const y0 = cy - Math.sin(rad) * len;
      const x1 = cx + Math.cos(rad) * len;
      const y1 = cy + Math.sin(rad) * len;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, options.color1);
      grad.addColorStop(1, options.color2);
      return grad;
    }
    return options.color1;
  };

  if (options.position === 'outside') {
    canvas.width = w + 2 * bw;
    canvas.height = h + 2 * bw;

    if (options.style === 'dashed') {
      ctx.drawImage(source, bw, bw);

      ctx.save();
      ctx.strokeStyle = options.color1;
      ctx.lineWidth = bw;
      ctx.setLineDash([Math.max(2, Math.round(options.dashLength * scaleRatio)), Math.max(2, Math.round(options.dashGap * scaleRatio))]);
      ctx.beginPath();
      if (r > 0 && ctx.roundRect) {
        ctx.roundRect(bw / 2, bw / 2, canvas.width - bw, canvas.height - bw, r);
      } else {
        ctx.rect(bw / 2, bw / 2, canvas.width - bw, canvas.height - bw);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = getStrokeOrFillStyle(canvas.width, canvas.height);
      if (r > 0 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.fill();
      } else {
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.save();
      if (r > 0 && ctx.roundRect) {
        const innerR = Math.max(0, r - bw);
        ctx.beginPath();
        ctx.roundRect(bw, bw, w, h, innerR);
        ctx.clip();
      }
      ctx.drawImage(source, bw, bw);
      ctx.restore();
    }
  } else {
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(source, 0, 0);

    ctx.save();
    ctx.strokeStyle = getStrokeOrFillStyle(w, h);
    ctx.lineWidth = bw;

    if (options.style === 'dashed') {
      ctx.setLineDash([Math.max(2, Math.round(options.dashLength * scaleRatio)), Math.max(2, Math.round(options.dashGap * scaleRatio))]);
    }

    ctx.beginPath();
    const half = bw / 2;
    if (r > 0 && ctx.roundRect) {
      ctx.roundRect(half, half, w - bw, h - bw, r);
    } else {
      ctx.rect(half, half, w - bw, h - bw);
    }
    ctx.stroke();
    ctx.restore();
  }

  return canvas;
}

export default function AddBorderTool() {
  return (
    <FilterEditorShell<AddBorderOptions>
      toolId="img-add-border"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-border"
      render={renderAddBorder}
      renderControls={(options, setOptions) => {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Border type">
                <Select
                  value={options.style}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      style: e.target.value as BorderStyle,
                    }))
                  }
                  options={[
                    { value: 'solid', label: 'Solid color' },
                    { value: 'gradient', label: 'Gradient' },
                    { value: 'dashed', label: 'Dashed line' },
                  ]}
                />
              </Field>

              <Field label="Border position">
                <Select
                  value={options.position}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      position: e.target.value as BorderPosition,
                    }))
                  }
                  options={[
                    { value: 'outside', label: 'Outside image (expands size)' },
                    { value: 'inside', label: 'Inside image (overlay edge)' },
                  ]}
                />
              </Field>

              <Field label={`Border width (${options.width}px)`}>
                <Slider
                  value={options.width}
                  min={1}
                  max={100}
                  step={1}
                  unit="px"
                  onChange={(v) => setOptions((prev) => ({ ...prev, width: v }))}
                />
              </Field>

              <Field label={`Corner radius (${options.radius}px)`}>
                <Slider
                  value={options.radius}
                  min={0}
                  max={100}
                  step={1}
                  unit="px"
                  onChange={(v) => setOptions((prev) => ({ ...prev, radius: v }))}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label={options.style === 'gradient' ? 'Start colour' : 'Border colour'}>
                <input
                  type="color"
                  value={options.color1}
                  onChange={(e) => setOptions((prev) => ({ ...prev, color1: e.target.value }))}
                  style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                />
              </Field>

              {options.style === 'gradient' && (
                <>
                  <Field label="End colour">
                    <input
                      type="color"
                      value={options.color2}
                      onChange={(e) => setOptions((prev) => ({ ...prev, color2: e.target.value }))}
                      style={{ width: '100%', height: '38px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
                    />
                  </Field>

                  <Field label={`Gradient angle (${options.gradientAngle}°)`}>
                    <Slider
                      value={options.gradientAngle}
                      min={0}
                      max={360}
                      step={5}
                      unit="°"
                      onChange={(v) => setOptions((prev) => ({ ...prev, gradientAngle: v }))}
                    />
                  </Field>
                </>
              )}

              {options.style === 'dashed' && (
                <>
                  <Field label={`Dash length (${options.dashLength}px)`}>
                    <Slider
                      value={options.dashLength}
                      min={5}
                      max={60}
                      step={1}
                      unit="px"
                      onChange={(v) => setOptions((prev) => ({ ...prev, dashLength: v }))}
                    />
                  </Field>
                  <Field label={`Dash gap (${options.dashGap}px)`}>
                    <Slider
                      value={options.dashGap}
                      min={2}
                      max={40}
                      step={1}
                      unit="px"
                      onChange={(v) => setOptions((prev) => ({ ...prev, dashGap: v }))}
                    />
                  </Field>
                </>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
