import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Button } from '../../../components/Controls';

interface InvertOptions {
  invertR: boolean;
  invertG: boolean;
  invertB: boolean;
}

const DEFAULT_OPTIONS: InvertOptions = {
  invertR: true,
  invertG: true,
  invertB: true,
};

function renderInvert(source: HTMLCanvasElement, options: InvertOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;

  const invR = options.invertR;
  const invG = options.invertG;
  const invB = options.invertB;

  for (let i = 0; i < len; i += 4) {
    if (invR) data[i] = 255 - data[i];
    if (invG) data[i + 1] = 255 - data[i + 1];
    if (invB) data[i + 2] = 255 - data[i + 2];
    // Keep alpha untouched
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export default function InvertTool() {
  return (
    <FilterEditorShell<InvertOptions>
      toolId="img-invert"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-inverted"
      render={renderInvert}
      renderControls={(options, setOptions, { t }) => {
        const toggleAll = (state: boolean) => {
          setOptions({ invertR: state, invertG: state, invertB: state });
        };

        const allChecked = options.invertR && options.invertG && options.invertB;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <Button variant={allChecked ? 'primary' : 'secondary'} type="button" onClick={() => toggleAll(!allChecked)}>
                {allChecked ? t('Full negative (active)') : t('Select all channels')}
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--surface)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: options.invertR ? '1px solid #ef4444' : '1px solid transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={options.invertR}
                  onChange={(e) => setOptions((prev) => ({ ...prev, invertR: e.target.checked }))}
                />
                <span style={{ fontWeight: 500, color: '#ef4444' }}>{t('Invert red channel')}</span>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--surface)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: options.invertG ? '1px solid #22c55e' : '1px solid transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={options.invertG}
                  onChange={(e) => setOptions((prev) => ({ ...prev, invertG: e.target.checked }))}
                />
                <span style={{ fontWeight: 500, color: '#22c55e' }}>{t('Invert green channel')}</span>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--surface)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: options.invertB ? '1px solid #3b82f6' : '1px solid transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={options.invertB}
                  onChange={(e) => setOptions((prev) => ({ ...prev, invertB: e.target.checked }))}
                />
                <span style={{ fontWeight: 500, color: '#3b82f6' }}>{t('Invert blue channel')}</span>
              </label>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{t('Alpha transparency is preserved intact.')}</p>
          </div>
        );
      }}
    />
  );
}
