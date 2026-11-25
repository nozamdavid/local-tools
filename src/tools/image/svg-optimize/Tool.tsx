import { useState } from 'react';
import { Button } from '../../../components/Controls';
import { ContinueWith } from '../../../components/ContinueWith';
import { FileDrop } from '../../../components/FileDrop';
import { ToolPage } from '../../../components/ToolPage';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { createSafeSvgPreview, getSvgSizeChange, MAX_SVG_BYTES, optimizeSvgText } from './optimizer';
import styles from './Tool.module.css';

interface OptimizationResult {
  blob: Blob;
  originalPreview: Blob | null;
  optimizedPreview: Blob | null;
  sizeStatus: ReturnType<typeof getSvgSizeChange>;
}

export default function SvgOptimizeTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-svg-optimize');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalPreviewUrl = useObjectUrl(result?.originalPreview ?? null);
  const optimizedPreviewUrl = useObjectUrl(result?.optimizedPreview ?? null);

  const handleFiles = (files: File[]) => {
    const selected = files[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);
    setError(null);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const optimize = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > MAX_SVG_BYTES) throw new Error('SVG files must be 5 MB or smaller.');
      const source = await file.text();
      const optimized = await optimizeSvgText(source);
      const blob = new Blob([optimized], { type: 'image/svg+xml' });
      const originalPreviewSvg = createSafeSvgPreview(source);
      const optimizedPreviewSvg = createSafeSvgPreview(optimized);

      setResult({
        blob,
        originalPreview: originalPreviewSvg ? new Blob([originalPreviewSvg], { type: 'image/svg+xml' }) : null,
        optimizedPreview: optimizedPreviewSvg ? new Blob([optimizedPreviewSvg], { type: 'image/svg+xml' }) : null,
        sizeStatus: getSvgSizeChange(file.size, blob.size),
      });
    } catch (err) {
      setError(
        err instanceof Error && 'sourceEnglish' in err
          ? String(err.sourceEnglish)
          : err instanceof Error
            ? err.message
            : 'Could not optimize this SVG.',
      );
    } finally {
      setBusy(false);
    }
  };

  const basename = file?.name.replace(/\.svg$/i, '') || 'image';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-svg-optimize">
      <div className={styles.tool}>
        {!file ? (
          <FileDrop
            accept="image/svg+xml,.svg"
            label={t('Choose an SVG or drop it here')}
            hint={t('SVG files up to 5 MB are processed locally in your browser.')}
            onFiles={handleFiles}
          />
        ) : result ? (
          <section className={styles.resultCard} aria-labelledby="svg-result-title">
            <h2 className={styles.resultTitle} id="svg-result-title">
              {t('Optimization result')}
            </h2>
            <p className={styles.sizeNote}>
              {t('Original: {size}', { size: formatBytes(file.size) })} · {t('Result: {size}', { size: formatBytes(result.blob.size) })}
              {result.sizeStatus.status === 'smaller' && ` · ${formatBytes(result.sizeStatus.difference)} ${t('smaller')}`}
              {result.sizeStatus.status === 'same' && ` · ${t('same size')}`}
              {result.sizeStatus.status === 'larger' && ` · ${formatBytes(result.sizeStatus.difference)} ${t('larger')}`}
            </p>

            {result.sizeStatus.status === 'larger' && (
              <p className={styles.sizeWarning} role="status">
                {t('The optimized SVG is larger than the original. Compare both sizes and download the version you prefer.')}
              </p>
            )}

            <div className={styles.previewGrid}>
              <figure className={styles.previewCard}>
                <figcaption>
                  {t('Original')} · {file.name}
                </figcaption>
                <div className={styles.previewFrame}>
                  {originalPreviewUrl ? (
                    <img
                      className={styles.previewImage}
                      src={originalPreviewUrl}
                      alt={t('Safe preview of the original {filename}', { filename: file.name })}
                    />
                  ) : (
                    <p className={styles.previewUnavailable}>
                      {t('Preview hidden because this SVG references external resources or contains unsafe markup.')}
                    </p>
                  )}
                </div>
              </figure>
              <figure className={styles.previewCard}>
                <figcaption>{t('Optimized SVG')}</figcaption>
                <div className={styles.previewFrame}>
                  {optimizedPreviewUrl ? (
                    <img
                      className={styles.previewImage}
                      src={optimizedPreviewUrl}
                      alt={t('Safe preview of the optimized {filename}', { filename: file.name })}
                    />
                  ) : (
                    <p className={styles.previewUnavailable}>
                      {t('Preview hidden because this SVG references external resources or contains unsafe markup.')}
                    </p>
                  )}
                </div>
              </figure>
            </div>

            <div className={styles.downloadActions}>
              <ContinueWith results={[{ name: `${basename}-optimized.svg`, blob: result.blob }]} />
              <Button variant="secondary" onClick={() => downloadBlob(file, file.name)}>
                {t('Download original')}
              </Button>
              <Button variant="primary" onClick={() => downloadBlob(result.blob, `${basename}-optimized.svg`)}>
                {t('Download optimized SVG')}
              </Button>
              <Button variant="ghost" onClick={reset}>
                {t('Start over')}
              </Button>
            </div>
          </section>
        ) : (
          <section className={styles.fileCard} aria-label={t('SVG selected')}>
            <div className={styles.fileMeta}>
              <span className={styles.fileName}>{file.name}</span>
              <span>
                {formatBytes(file.size)} · {t('maximum 5 MB')}
              </span>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {t(error)}
              </div>
            )}
            <div className={styles.actions}>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                {t('Choose another SVG')}
              </Button>
              <Button variant="primary" onClick={() => void optimize()} loading={busy}>
                {t('Optimize SVG')}
              </Button>
            </div>
          </section>
        )}
      </div>
    </ToolPage>
  );
}
