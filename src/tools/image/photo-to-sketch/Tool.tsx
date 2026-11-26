import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider } from '../../../components/Controls';
import { filterWorkerClient } from '../_filters/workerClient';
import type { SketchOptions } from '../_filters/worker';

const DEFAULT_OPTIONS: SketchOptions = {
  style: 'pencil',
  intensity: 85,
};

async function renderSketch(source: HTMLCanvasElement, options: SketchOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const outData = await filterWorkerClient.process(imgData, { type: 'sketch', options });

  const outImgData = ctx.createImageData(canvas.width, canvas.height);
  outImgData.data.set(outData);
  ctx.putImageData(outImgData, 0, 0);
  return canvas;
}

export default function PhotoToSketchTool() {
  return (
    <FilterEditorShell<SketchOptions>
      toolId="img-photo-to-sketch"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-sketch"
      render={renderSketch}
      renderControls={(options, setOptions, { t }) => {
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            <Field label={t('Artistic style')}>
              <Select
                value={options.style}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    style: e.target.value as SketchOptions['style'],
                  }))
                }
                options={[
                  { value: 'pencil', label: t('✏️ Pencil sketch') },
                  { value: 'color-sketch', label: t('🎨 Colour sketch') },
                  { value: 'cartoon', label: t('🗯️ Cartoon (comic & edges)') },
                  { value: 'sepia', label: t('📜 Sepia vintage') },
                  { value: 'oil', label: t('🖌️ Oil painting (Kuwahara)') },
                ]}
              />
            </Field>

            <Field label={t('Effect intensity ({intensity}%)', { intensity: options.intensity })}>
              <Slider
                value={options.intensity}
                min={10}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setOptions((prev) => ({ ...prev, intensity: v }))}
              />
            </Field>
          </div>
        );
      }}
    />
  );
}
