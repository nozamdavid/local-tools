import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getDefaultFormat, formatOutputFile } from '../_basic';
import styles from '../_basic/basic.module.css';

interface FlipResult {
  blob: Blob;
  filename: string;
}

export default function FlipTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-flip');
  const [file, setFile] = useState<File | null>(null);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<FlipResult | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    setFile(files[0]);
    setMetaError(null);
    setResultInfo(null);
    setFlipH(false);
    setFlipV(false);
    job.reset();
  };

  const handleReset = () => {
    setFile(null);
    setFlipH(false);
    setFlipV(false);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const handleApply = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      setProgress(0.2);
      const img = await decodeImage(file);
      setProgress(0.5);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(t('Canvas 2D unavailable'));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const { mime, ext } = getDefaultFormat(file, 'image/png');

      const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? undefined : 0.92);
      setProgress(1.0);

      const suffix = flipH && flipV ? '-flipped-hv' : flipH ? '-flipped-h' : flipV ? '-flipped-v' : '-flipped';
      const info: FlipResult = {
        blob,
        filename: formatOutputFile(file.name, suffix, ext),
      };
      setResultInfo(info);
      return blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-flip">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or drag it here')}
          hint={t('Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={originalUrl ? <img src={originalUrl} alt={file.name} className="preview-media" /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name')}: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Flipping image...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Live preview */}
                  <div className={styles.livePreviewContainer}>
                    {originalUrl && (
                      <img
                        src={originalUrl}
                        alt={t('Preview')}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '400px',
                          objectFit: 'contain',
                          transform: `scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
                          transition: 'transform 0.2s ease',
                        }}
                      />
                    )}
                  </div>

                  <Field label={t('Flip orientation')}>
                    <div className={styles.btnGroup}>
                      <button
                        type="button"
                        className={`${styles.presetChip} ${flipH && !flipV ? styles.presetChipActive : ''}`}
                        onClick={() => {
                          setFlipH(!flipH);
                        }}
                      >
                        ↔ {t('Flip horizontal')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.presetChip} ${!flipH && flipV ? styles.presetChipActive : ''}`}
                        onClick={() => {
                          setFlipV(!flipV);
                        }}
                      >
                        ↕ {t('Flip vertical')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.presetChip} ${flipH && flipV ? styles.presetChipActive : ''}`}
                        onClick={() => {
                          setFlipH(true);
                          setFlipV(true);
                        }}
                      >
                        🔄 {t('Flip both')}
                      </button>
                      <button
                        type="button"
                        className={styles.presetChip}
                        onClick={() => {
                          setFlipH(false);
                          setFlipV(false);
                        }}
                        disabled={!flipH && !flipV}
                      >
                        {t('Reset')}
                      </button>
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different image')}
                    </Button>
                    <Button variant="primary" onClick={handleApply}>
                      {t('Save flipped image')}
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
