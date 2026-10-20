import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { compressToTargetSize, type TargetSizeResult } from '../_basic';
import styles from '../_basic/basic.module.css';

type SizeUnit = 'KB' | 'MB';

interface Preset {
  label: string;
  bytes: number;
  val: number;
  unit: SizeUnit;
}

const PRESETS: Preset[] = [
  { label: '50 KB', bytes: 50 * 1024, val: 50, unit: 'KB' },
  { label: '100 KB', bytes: 100 * 1024, val: 100, unit: 'KB' },
  { label: '200 KB', bytes: 200 * 1024, val: 200, unit: 'KB' },
  { label: '500 KB', bytes: 500 * 1024, val: 500, unit: 'KB' },
  { label: '1 MB', bytes: 1024 * 1024, val: 1, unit: 'MB' },
];

export default function CompressImageTool() {
  const meta = getToolMeta('img-compress-image');
  const [file, setFile] = useState<File | null>(null);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number } | null>(null);
  const [targetValue, setTargetValue] = useState<number>(100);
  const [unit, setUnit] = useState<SizeUnit>('KB');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<TargetSizeResult | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

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
    } catch {
      setMetaError('Could not read image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setImgMeta(null);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const targetBytes = Math.round(targetValue * (unit === 'MB' ? 1024 * 1024 : 1024));

  const applyPreset = (preset: Preset) => {
    setTargetValue(preset.val);
    setUnit(preset.unit);
  };

  const handleCompress = () => {
    if (!file || targetBytes <= 0) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const res = await compressToTargetSize(file, targetBytes);
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-compress-image">
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
              beforePreview={
                originalUrl ? (
                  <img src={originalUrl} alt={file.name} className="preview-media" />
                ) : null
              }
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  Target size: <strong>{formatBytes(targetBytes)}</strong>
                </span>
                <span className="meta-chip">
                  Achieved size: <strong>{formatBytes(resultInfo.achievedBytes)}</strong>
                </span>
                <span className="meta-chip">
                  Target reached: <strong>{resultInfo.achievedBytes <= targetBytes ? 'Yes (≤ Target)' : 'Closest match'}</strong>
                </span>
                <span className="meta-chip">
                  Output resolution: <strong>{resultInfo.width}×{resultInfo.height} px</strong>
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
                  Current size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {imgMeta && (
                  <span className="meta-chip">
                    Dimensions: <strong>{imgMeta.width}×{imgMeta.height} px</strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Optimizing to target size..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Target file size" hint="Specify desired maximum file size">
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={targetValue}
                        onChange={(e) => setTargetValue(Math.max(1, parseFloat(e.target.value) || 1))}
                        className={styles.inputNumber}
                        style={{ flex: 1 }}
                      />
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as SizeUnit)}
                        className="select"
                        style={{ width: '100px' }}
                      >
                        <option value="KB">KB</option>
                        <option value="MB">MB</option>
                      </select>
                    </div>

                    <div className={styles.presetChips}>
                      {PRESETS.map((p) => {
                        const isActive = targetBytes === p.bytes;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`${styles.presetChip} ${isActive ? styles.presetChipActive : ''}`}
                            onClick={() => applyPreset(p)}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      Compress to {targetValue} {unit}
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
