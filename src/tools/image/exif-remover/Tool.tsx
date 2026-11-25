import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button } from '../../../components/Controls';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { ProgressBar } from '../../../components/ProgressBar';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { formatBytes } from '../../../lib/format';
import { stripFileMetadata, type StripResult } from './remover';
import styles from './Tool.module.css';

export default function ExifRemoverTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-exif-remover');

  const [files, setFiles] = useState<File[]>([]);
  const [applyOrientation, setApplyOrientation] = useState<boolean>(false);
  const [keepIcc, setKeepIcc] = useState<boolean>(true);

  const [processing, setProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [results, setResults] = useState<StripResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles(incoming);
    setResults([]);
    setError(null);
  };

  const handleStrip = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);

    const out: StripResult[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await stripFileMetadata(file, { applyOrientation, keepIcc });
        out.push(res);
        setProgress((i + 1) / files.length);
      }
      setResults(out);
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('Failed to strip metadata'));
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResults([]);
    setError(null);
    setProgress(0);
  };

  const batchItems: BatchResultItem[] = results.map((r) => ({
    name: r.filename,
    blob: r.blob,
    originalSize: r.originalSize,
  }));

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-exif-remover">
      <div className={styles.container}>
        {error && <div className="error-banner">{t(error)}</div>}

        {files.length === 0 ? (
          <FileDrop
            accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.tiff,.tif"
            multiple
            label={t('Drop photos here to remove EXIF & metadata')}
            hint={t('Supports JPG, PNG, WEBP and more. Batch supported. 100% lossless byte stream rewriting.')}
            onFiles={handleFiles}
          />
        ) : results.length > 0 ? (
          <div>
            <div className={styles.removedSummaryList}>
              <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>{t('Metadata removal summary')}</div>
              {results.map((r, idx) => (
                <div key={`${r.filename}-${idx}`} className={styles.removedCard}>
                  <div>
                    <strong>{r.filename}</strong>{' '}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      ({formatBytes(r.originalSize)} → {formatBytes(r.blob.size)})
                    </span>
                    {r.lossless && (
                      <span
                        style={{
                          marginLeft: '0.5rem',
                          fontSize: '0.75rem',
                          background: 'var(--success-soft)',
                          color: 'var(--success)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        {t('Lossless (identical pixels)')}
                      </span>
                    )}
                  </div>
                  <div className={styles.removedTags}>
                    {r.removed.map((tag, tIdx) => (
                      <span key={tIdx} className={styles.removedTag}>
                        {t(tag)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <BatchResults items={batchItems} onReset={handleReset} />
          </div>
        ) : (
          <div>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('Selected')}: <strong>{t('{count} files', { count: files.length })}</strong>
              </span>
              <span className="meta-chip">
                {t('Total size')}: <strong>{formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</strong>
              </span>
            </div>

            <div className={styles.optionsCard} style={{ marginTop: '1.5rem' }}>
              <div className={styles.optionsTitle}>{t('Stripping options')}</div>
              <div className={styles.optionsGrid}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    className={styles.checkboxInput}
                    checked={keepIcc}
                    onChange={(e) => setKeepIcc(e.target.checked)}
                  />
                  <div className={styles.checkboxLabel}>
                    <span className={styles.checkboxTitle}>{t('Keep ICC colour profile (APP2)')}</span>
                    <span className={styles.checkboxHint}>
                      {t('Preserves wide gamut and colour management profiles so colours do not shift.')}
                    </span>
                  </div>
                </label>

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    className={styles.checkboxInput}
                    checked={applyOrientation}
                    onChange={(e) => setApplyOrientation(e.target.checked)}
                  />
                  <div className={styles.checkboxLabel}>
                    <span className={styles.checkboxTitle}>{t('Apply orientation before stripping (re-encode)')}</span>
                    <span className={styles.checkboxHint}>
                      {t(
                        "If photos have EXIF rotation tags, applies the rotation into the pixel data so they don't appear rotated after removing EXIF.",
                      )}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {processing ? (
              <div style={{ marginTop: '1.5rem' }}>
                <ProgressBar value={progress} label={t('Stripping metadata losslessly…')} />
              </div>
            ) : (
              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Choose different files')}
                </Button>
                <Button variant="primary" onClick={handleStrip}>
                  {t('Strip metadata ({count} files)', { count: files.length })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </ToolPage>
  );
}
