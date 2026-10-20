import { useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT, decodeImage, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { resizeImage, getDefaultFormat } from '../_basic';
import styles from '../_basic/basic.module.css';

type BulkResizeMode = 'percent' | 'maxDim';
type FormatChoice = 'keep' | 'image/jpeg' | 'image/png' | 'image/webp';

export default function BulkResizeTool() {
  const meta = getToolMeta('img-bulk-resize');
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<BulkResizeMode>('percent');
  const [percent, setPercent] = useState<number>(50);
  const [maxDimension, setMaxDimension] = useState<number>(1920);
  const [formatChoice, setFormatChoice] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState<number>(85);

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modeId = useId();
  const formatId = useId();

  const handleFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setFiles(newFiles);
    setResults(null);
    setError(null);
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setProcessing(false);
    setProgress(0);
  };

  const handleProcess = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);

    const outputItems: BatchResultItem[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const img = await decodeImage(file);

        let targetW = img.width;
        let targetH = img.height;

        if (mode === 'percent') {
          targetW = Math.max(1, Math.round(img.width * (percent / 100)));
          targetH = Math.max(1, Math.round(img.height * (percent / 100)));
        } else {
          const maxEdge = Math.max(img.width, img.height);
          if (maxEdge > maxDimension) {
            const scale = maxDimension / maxEdge;
            targetW = Math.max(1, Math.round(img.width * scale));
            targetH = Math.max(1, Math.round(img.height * scale));
          }
        }

        const outMime: EncodableMime | undefined =
          formatChoice === 'keep' ? getDefaultFormat(file, 'image/png').mime : formatChoice;

        const res = await resizeImage(file, {
          width: targetW,
          height: targetH,
          format: outMime,
          quality: quality / 100,
        });

        outputItems.push({
          name: res.filename,
          blob: res.blob,
          originalSize: file.size,
        });

        setProgress((i + 1) / files.length);
      }

      setResults(outputItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while resizing images.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-bulk-resize">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label="Choose multiple images or drag them here"
          hint="Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF. Batch process 100% on-device."
          onFiles={handleFiles}
        />
      ) : results ? (
        <BatchResults items={results} onReset={handleReset} />
      ) : (
        <div>
          {error && <div className="error-banner">{error}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              Selected files: <strong>{files.length}</strong>
            </span>
            <span className="meta-chip">
              Total size: <strong>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</strong>
            </span>
          </div>

          {processing ? (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar
                value={progress}
                label={`Resizing images (${Math.round(progress * files.length)} of ${files.length})...`}
              />
            </div>
          ) : (
            <div style={{ marginTop: '1.5rem' }}>
              <Field label="Resize mode">
                <Select
                  id={modeId}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as BulkResizeMode)}
                  options={[
                    { value: 'percent', label: 'Scale by percentage (recommended for mixed sizes)' },
                    { value: 'maxDim', label: 'Constrain max dimension' },
                  ]}
                />
              </Field>

              {mode === 'percent' ? (
                <Field label="Scale percentage">
                  <Slider
                    value={percent}
                    min={5}
                    max={200}
                    step={5}
                    unit="%"
                    onChange={setPercent}
                  />
                  <div className={styles.presetChips}>
                    {[25, 50, 75, 100, 150].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`${styles.presetChip} ${percent === p ? styles.presetChipActive : ''}`}
                        onClick={() => setPercent(p)}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </Field>
              ) : (
                <Field label="Max dimension (px)" hint="Images larger than this max width/height will be scaled down">
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={maxDimension}
                    onChange={(e) => setMaxDimension(parseInt(e.target.value, 10) || 100)}
                    className={styles.inputNumber}
                  />
                  <div className={styles.presetChips}>
                    {[800, 1080, 1280, 1920, 2560].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.presetChip} ${maxDimension === d ? styles.presetChipActive : ''}`}
                        onClick={() => setMaxDimension(d)}
                      >
                        {d} px
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Output format">
                <Select
                  id={formatId}
                  value={formatChoice}
                  onChange={(e) => setFormatChoice(e.target.value as FormatChoice)}
                  options={[
                    { value: 'keep', label: 'Keep original format' },
                    { value: 'image/jpeg', label: 'JPG' },
                    { value: 'image/png', label: 'PNG' },
                    { value: 'image/webp', label: 'WEBP' },
                  ]}
                />
              </Field>

              {formatChoice !== 'image/png' && (
                <Field label="Quality">
                  <Slider
                    value={quality}
                    min={10}
                    max={100}
                    step={1}
                    unit="%"
                    onChange={setQuality}
                  />
                </Field>
              )}

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Choose different files
                </Button>
                <Button variant="primary" onClick={handleProcess}>
                  Resize {files.length} {files.length === 1 ? 'image' : 'images'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
