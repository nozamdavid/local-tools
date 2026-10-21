import { FilterEditorShell } from '../_filters/FilterEditorShell';
import { Slider } from '../../../components/Controls';
import { filterWorkerClient } from '../_filters/workerClient';
import styles from '../_filters/FilterEditorShell.module.css';

interface SharpenOptions {
  amount: number;
  radius: number;
  threshold: number;
}

const DEFAULT_OPTIONS: SharpenOptions = {
  amount: 1.2,
  radius: 1.5,
  threshold: 0,
};

async function renderSharpen(source: HTMLCanvasElement, options: SharpenOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const outData = await filterWorkerClient.process('sharpen', canvas.width, canvas.height, imgData.data, options);

  const outImgData = ctx.createImageData(canvas.width, canvas.height);
  outImgData.data.set(outData);
  ctx.putImageData(outImgData, 0, 0);
  return canvas;
}

export default function SharpenTool() {
  return (
    <FilterEditorShell<SharpenOptions>
      toolId="img-sharpen"
      defaultOptions={DEFAULT_OPTIONS}
      suffix="-sharpened"
      render={renderSharpen}
      renderControls={(options, setOptions) => {
        const update = (key: keyof SharpenOptions, val: number) => {
          setOptions((prev) => ({ ...prev, [key]: val }));
        };

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
            <div className={styles.sliderWithReset}>
              <div className={styles.sliderHeader}>
                <span className="field-label" style={{ marginBottom: 0 }}>
                  Amount ({Math.round(options.amount * 100)}%)
                </span>
                {options.amount !== DEFAULT_OPTIONS.amount && (
                  <button type="button" className={styles.resetMiniBtn} onClick={() => update('amount', DEFAULT_OPTIONS.amount)}>
                    Reset
                  </button>
                )}
              </div>
              <Slider value={options.amount} min={0.1} max={3.0} step={0.1} unit="x" onChange={(v) => update('amount', v)} />
            </div>

            <div className={styles.sliderWithReset}>
              <div className={styles.sliderHeader}>
                <span className="field-label" style={{ marginBottom: 0 }}>
                  Radius ({options.radius}px)
                </span>
                {options.radius !== DEFAULT_OPTIONS.radius && (
                  <button type="button" className={styles.resetMiniBtn} onClick={() => update('radius', DEFAULT_OPTIONS.radius)}>
                    Reset
                  </button>
                )}
              </div>
              <Slider value={options.radius} min={0.5} max={10.0} step={0.5} unit="px" onChange={(v) => update('radius', v)} />
            </div>

            <div className={styles.sliderWithReset}>
              <div className={styles.sliderHeader}>
                <span className="field-label" style={{ marginBottom: 0 }}>
                  Threshold ({options.threshold})
                </span>
                {options.threshold !== DEFAULT_OPTIONS.threshold && (
                  <button type="button" className={styles.resetMiniBtn} onClick={() => update('threshold', DEFAULT_OPTIONS.threshold)}>
                    Reset
                  </button>
                )}
              </div>
              <Slider value={options.threshold} min={0} max={50} step={1} unit="" onChange={(v) => update('threshold', v)} />
            </div>
          </div>
        );
      }}
    />
  );
}
