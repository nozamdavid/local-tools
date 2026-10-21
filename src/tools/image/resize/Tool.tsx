import { useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getDefaultFormat, resizeImage, type ResizeResult } from '../_basic';
import styles from '../_basic/basic.module.css';

type ResizeMode = 'percent' | 'pixels';

export default function ResizeTool() {
  const meta = getToolMeta('img-resize');
  const [file, setFile] = useState<File | null>(null);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<ResizeMode>('percent');
  const [percent, setPercent] = useState<number>(50);
  const [pixelWidth, setPixelWidth] = useState<number>(0);
  const [pixelHeight, setPixelHeight] = useState<number>(0);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [format, setFormat] = useState<EncodableMime>('image/jpeg');
  const [quality, setQuality] = useState<number>(85);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<ResizeResult | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const modeId = useId();
  const formatId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setImgMeta(null);
    setResultInfo(null);
    job.reset();

    try {
      const img = await decodeImage(selected);
      setImgMeta({ width: img.width, height: img.height });
      setPixelWidth(Math.round(img.width * 0.5));
      setPixelHeight(Math.round(img.height * 0.5));
      const defFmt = getDefaultFormat(selected, 'image/png');
      setFormat(defFmt.mime);
    } catch {
      setMetaError('Could not decode the image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setImgMeta(null);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const handleWidthChange = (val: number) => {
    setPixelWidth(val);
    if (lockAspect && imgMeta && imgMeta.width > 0) {
      setPixelHeight(Math.max(1, Math.round((val / imgMeta.width) * imgMeta.height)));
    }
  };

  const handleHeightChange = (val: number) => {
    setPixelHeight(val);
    if (lockAspect && imgMeta && imgMeta.height > 0) {
      setPixelWidth(Math.max(1, Math.round((val / imgMeta.height) * imgMeta.width)));
    }
  };

  const targetW = imgMeta ? (mode === 'percent' ? Math.max(1, Math.round(imgMeta.width * (percent / 100))) : Math.max(1, pixelWidth)) : 0;

  const targetH = imgMeta ? (mode === 'percent' ? Math.max(1, Math.round(imgMeta.height * (percent / 100))) : Math.max(1, pixelHeight)) : 0;

  const handleResize = () => {
    if (!file || !imgMeta || targetW <= 0 || targetH <= 0) return;

    job.run(async (setProgress) => {
      setProgress(0.2);
      const res = await resizeImage(file, {
        width: targetW,
        height: targetH,
        format,
        quality: quality / 100,
      });
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-resize">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image or drag it here"
          hint="Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={originalUrl ? <img src={originalUrl} alt={file.name} className="preview-media" /> : null}
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  Dimensions:{' '}
                  <strong>
                    {imgMeta ? `${imgMeta.width}×${imgMeta.height}` : ''} → {resultInfo.width}×{resultInfo.height} px
                  </strong>
                </span>
              </div>
            </ResultPanel>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  Name: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {imgMeta && (
                  <span className="meta-chip">
                    Original dimensions:{' '}
                    <strong>
                      {imgMeta.width}×{imgMeta.height} px
                    </strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Resizing image..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Resize mode">
                    <Select
                      id={modeId}
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ResizeMode)}
                      options={[
                        { value: 'percent', label: 'By percentage' },
                        { value: 'pixels', label: 'By exact pixels' },
                      ]}
                    />
                  </Field>

                  {mode === 'percent' ? (
                    <Field label="Scale percentage" hint="Choose percentage of original size">
                      <Slider value={percent} min={5} max={300} step={5} unit="%" onChange={setPercent} />
                      <div className={styles.presetChips}>
                        {[25, 50, 75, 100, 150, 200].map((p) => (
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
                    <Field label="Dimensions (pixels)" hint="Enter target width and height in pixels">
                      <div className={styles.dimensionGrid}>
                        <div>
                          <label className="field-label" style={{ fontSize: '0.85rem' }}>
                            Width
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20000}
                            value={pixelWidth}
                            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 1)}
                            className={styles.inputNumber}
                          />
                        </div>
                        <button
                          type="button"
                          className={`${styles.lockBtn} ${lockAspect ? styles.lockBtnActive : ''}`}
                          onClick={() => setLockAspect(!lockAspect)}
                          title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                        >
                          {lockAspect ? '🔒' : '🔓'}
                        </button>
                        <div>
                          <label className="field-label" style={{ fontSize: '0.85rem' }}>
                            Height
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20000}
                            value={pixelHeight}
                            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 1)}
                            className={styles.inputNumber}
                          />
                        </div>
                      </div>
                    </Field>
                  )}

                  {imgMeta && (
                    <div className={styles.sizeComparison}>
                      <span>
                        Source:{' '}
                        <strong>
                          {imgMeta.width}×{imgMeta.height}
                        </strong>
                      </span>
                      <span className={styles.sizeArrow}>→</span>
                      <span>
                        Target:{' '}
                        <strong>
                          {targetW}×{targetH} px
                        </strong>
                      </span>
                    </div>
                  )}

                  <div style={{ marginTop: '1.25rem' }}>
                    <Field label="Output format">
                      <Select
                        id={formatId}
                        value={format}
                        onChange={(e) => setFormat(e.target.value as EncodableMime)}
                        options={[
                          { value: 'image/jpeg', label: 'JPG' },
                          { value: 'image/png', label: 'PNG' },
                          { value: 'image/webp', label: 'WEBP' },
                        ]}
                      />
                    </Field>
                  </div>

                  {format !== 'image/png' && (
                    <Field label="Quality" hint="Higher quality results in larger file size">
                      <Slider value={quality} min={10} max={100} step={1} unit="%" onChange={setQuality} />
                    </Field>
                  )}

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleResize}>
                      Resize image
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
