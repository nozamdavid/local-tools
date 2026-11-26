import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { renderDocxToImages } from './docxRenderer';

export function DocxImageTool({ format }: { format: 'image/png' | 'image/jpeg' }) {
  const { t } = useI18n();
  const isPng = format === 'image/png';
  const toolId = isPng ? 'img-docx-to-png' : 'img-docx-to-jpg';
  const meta = getToolMeta(toolId);
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<BatchResultItem[] | null>(null);
  const job = useJob();

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    setFile(files[0]);
    setItems(null);
    job.reset();
  };

  const handleReset = () => {
    setFile(null);
    setItems(null);
    job.reset();
  };

  const handleConvert = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const results = await renderDocxToImages(file, file.name, {
        format,
        onProgress: (cur, tot) => {
          setProgress(tot > 0 ? cur / tot : 0);
        },
      });

      setItems(results);
      return results[0]?.blob ?? new Blob([]);
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={toolId}>
      {!file ? (
        <FileDrop
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          label={t('Choose a Word (.docx) document or drag it here')}
          hint={
            isPng
              ? t('Renders Word documents into high-resolution lossless PNG images.')
              : t('Renders Word documents into high-resolution JPG images.')
          }
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {items && items.length > 0 ? (
            items.length === 1 ? (
              <ResultPanel blob={items[0].blob} filename={items[0].name} kind="image" originalSize={file.size} onReset={handleReset} />
            ) : (
              <BatchResults items={items} onReset={handleReset} />
            )
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Document')}: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem 1.25rem',
                  margin: '1.25rem 0',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                  ℹ️ {t('Conversion details & limitations')}
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {t(
                    'Documents are rendered on your device at 2× resolution for crisp text. Fonts not installed on your device will fall back to standard system fonts. Complex Word macros or external links are ignored for security and privacy.',
                  )}
                </p>
              </div>

              {job.status === 'running' ? (
                <ProgressBar
                  value={job.progress}
                  label={isPng ? t('Rendering Word document to PNG...') : t('Rendering Word document to JPG...')}
                />
              ) : (
                <div className="action-buttons" style={{ marginTop: '2rem' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Choose different file')}
                  </Button>
                  <Button variant="primary" onClick={handleConvert}>
                    {isPng ? t('Convert to PNG') : t('Convert to JPG')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
