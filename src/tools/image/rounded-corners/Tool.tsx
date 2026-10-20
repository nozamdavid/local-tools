import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Slider } from '../../../components/Controls';

interface RoundedCornersOptions {
  radius: number;
  independent: boolean;
  tlActive: boolean;
  trActive: boolean;
  brActive: boolean;
  blActive: boolean;
  tlRadius: number;
  trRadius: number;
  brRadius: number;
  blRadius: number;
  fillBackground: boolean;
  bgColor: string;
}

const DEFAULT_OPTIONS: RoundedCornersOptions = {
  radius: 60,
  independent: false,
  tlActive: true,
  trActive: true,
  brActive: true,
  blActive: true,
  tlRadius: 60,
  trRadius: 60,
  brRadius: 60,
  blRadius: 60,
  fillBackground: false,
  bgColor: '#ffffff',
};

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number]
) {
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function renderRoundedCorners(
  source: HTMLCanvasElement,
  options: RoundedCornersOptions,
  isPreview: boolean
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const w = source.width;
  const h = source.height;
  const scaleRatio = isPreview ? 1 : source.width / Math.min(1200, source.width);
  const baseR = Math.max(0, Math.round(options.radius * scaleRatio));

  const rTL = Math.round(
    options.independent
      ? options.tlActive ? options.tlRadius * scaleRatio : 0
      : options.tlActive ? baseR : 0
  );
  const rTR = Math.round(
    options.independent
      ? options.trActive ? options.trRadius * scaleRatio : 0
      : options.trActive ? baseR : 0
  );
  const rBR = Math.round(
    options.independent
      ? options.brActive ? options.brRadius * scaleRatio : 0
      : options.brActive ? baseR : 0
  );
  const rBL = Math.round(
    options.independent
      ? options.blActive ? options.blRadius * scaleRatio : 0
      : options.blActive ? baseR : 0
  );

  if (options.fillBackground) {
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  ctx.save();
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, [rTL, rTR, rBR, rBL]);
  } else {
    drawRoundedRectPath(ctx, 0, 0, w, h, [rTL, rTR, rBR, rBL]);
  }
  ctx.clip();
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  return canvas;
}

export default function RoundedCornersTool() {
  return (
    <FilterEditorShell<RoundedCornersOptions>
      toolId="img-rounded-corners"
      defaultOptions={DEFAULT_OPTIONS}
      defaultFormat="image/png"
      suffix="-rounded"
      render={renderRoundedCorners}
      renderControls={(options, setOptions) => {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={options.independent}
                  onChange={(e) => setOptions((prev) => ({ ...prev, independent: e.target.checked }))}
                />
                <span>Configure each corner independently</span>
              </label>
            </div>

            {!options.independent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={`Corner radius (${options.radius}px)`}>
                  <Slider
                    value={options.radius}
                    min={0}
                    max={250}
                    step={1}
                    unit="px"
                    onChange={(v) => setOptions((prev) => ({ ...prev, radius: v }))}
                  />
                </Field>

                <div>
                  <label className="field-label">Active corners</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={options.tlActive}
                        onChange={(e) => setOptions((prev) => ({ ...prev, tlActive: e.target.checked }))}
                      />
                      <span>Top Left</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={options.trActive}
                        onChange={(e) => setOptions((prev) => ({ ...prev, trActive: e.target.checked }))}
                      />
                      <span>Top Right</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={options.brActive}
                        onChange={(e) => setOptions((prev) => ({ ...prev, brActive: e.target.checked }))}
                      />
                      <span>Bottom Right</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={options.blActive}
                        onChange={(e) => setOptions((prev) => ({ ...prev, blActive: e.target.checked }))}
                      />
                      <span>Bottom Left</span>
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <Field label={`Top Left radius (${options.tlRadius}px)`}>
                  <Slider
                    value={options.tlRadius}
                    min={0}
                    max={250}
                    step={1}
                    unit="px"
                    onChange={(v) => setOptions((prev) => ({ ...prev, tlRadius: v, tlActive: v > 0 }))}
                  />
                </Field>
                <Field label={`Top Right radius (${options.trRadius}px)`}>
                  <Slider
                    value={options.trRadius}
                    min={0}
                    max={250}
                    step={1}
                    unit="px"
                    onChange={(v) => setOptions((prev) => ({ ...prev, trRadius: v, trActive: v > 0 }))}
                  />
                </Field>
                <Field label={`Bottom Right radius (${options.brRadius}px)`}>
                  <Slider
                    value={options.brRadius}
                    min={0}
                    max={250}
                    step={1}
                    unit="px"
                    onChange={(v) => setOptions((prev) => ({ ...prev, brRadius: v, brActive: v > 0 }))}
                  />
                </Field>
                <Field label={`Bottom Left radius (${options.blRadius}px)`}>
                  <Slider
                    value={options.blRadius}
                    min={0}
                    max={250}
                    step={1}
                    unit="px"
                    onChange={(v) => setOptions((prev) => ({ ...prev, blRadius: v, blActive: v > 0 }))}
                  />
                </Field>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--color-border, rgba(255, 255, 255, 0.1))', paddingTop: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={options.fillBackground}
                  onChange={(e) => setOptions((prev) => ({ ...prev, fillBackground: e.target.checked }))}
                />
                <span>Fill corners with solid background colour (recommended for JPG)</span>
              </label>

              {options.fillBackground && (
                <div style={{ marginTop: '0.75rem', maxWidth: '200px' }}>
                  <Field label="Background colour">
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
