import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Field, Select, Slider } from '../../../components/Controls';
import { filterWorkerClient } from '../_filters/workerClient';

interface SketchOptions {
  style: 'pencil' | 'color-sketch' | 'cartoon' | 'sepia' | 'oil';
  intensity: number;
}

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

  const outData = await filterWorkerClient.process('sketch', canvas.width, canvas.height, imgData.data, options);

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
      renderControls={(options, setOptions) => {
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            <Field label="Artistic style">
              <Select
                value={options.style}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    style: e.target.value as SketchOptions['style'],
                  }))
                }
                options={[
                  { value: 'pencil', label: '✏️ Pencil sketch' },
                  { value: 'color-sketch', label: '🎨 Colour sketch' },
                  { value: 'cartoon', label: '🗯️ Cartoon (comic & edges)' },
                  { value: 'sepia', label: '📜 Sepia vintage' },
                  { value: 'oil', label: '🖌️ Oil painting (Kuwahara)' },
                ]}
              />
            </Field>

            <Field label={`Effect intensity (${options.intensity}%)`}>
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
