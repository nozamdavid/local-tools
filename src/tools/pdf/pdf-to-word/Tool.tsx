import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { DownloadResult } from '../_layout/DownloadResult';
import { buildDocx } from './buildDocx';
import styles from './Tool.module.css';

export default function PdfToWordTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-pdf-to-word');
  const source = usePdfSource();
  const job = useJob();

  const [exactLayout, setExactLayout] = useState(false);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
  };

  const handleConvert = () => {
    const { doc, file } = source;
    if (!doc || !file) return;
    job.run((setProgress) => buildDocx(doc, file, { exactLayout, onProgress: setProgress }));
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}.docx` : 'document.docx';
  const total = source.pages.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Paragraphs, headings and tables become an editable DOCX.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('File:')} <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                {t('Size:')} <strong>{formatBytes(file.size)}</strong>
              </span>
              {source.doc && (
                <span className="meta-chip">
                  {t('Pages:')} <strong>{total}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleReset}>
              {t('Change PDF')}
            </Button>
          </div>

          {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}

          {job.result ? (
            <DownloadResult
              blob={job.result}
              filename={outName}
              summary={
                exactLayout
                  ? t('{count} {unit} converted as page images.', { count: total, unit: total === 1 ? t('page') : t('pages') })
                  : t('{count} {unit} converted to editable text.', { count: total, unit: total === 1 ? t('page') : t('pages') })
              }
              onReset={handleReset}
            />
          ) : (
            source.doc && (
              <>
                <div className={styles.layout}>
                  {source.pages[0] && (
                    <PageThumb
                      src={source.thumbs[0]}
                      width={source.pages[0].width}
                      height={source.pages[0].height}
                      alt={t('Page 1')}
                      box={180}
                    />
                  )}

                  <div className={styles.options}>
                    <details className="tool-options">
                      <summary>{t('Export options')}</summary>
                      <div className="tool-options-body">
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={exactLayout}
                            disabled={job.status === 'running'}
                            onChange={(e) => setExactLayout(e.target.checked)}
                          />
                          <span>
                            {t('Keep exact layout (page images)')}
                            <small>{t('Each page is an image, so the layout stays intact but the text is not editable.')}</small>
                          </span>
                        </label>
                      </div>
                    </details>
                  </div>
                </div>

                {job.status === 'running' ? (
                  <ProgressBar value={job.progress} label={t('Converting to Word…')} />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="primary" onClick={handleConvert}>
                      {t('Convert to DOCX')}
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}
    </ToolPage>
  );
}
