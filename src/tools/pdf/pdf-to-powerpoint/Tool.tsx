import { useId, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field, Select } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { DownloadResult } from '../_layout/DownloadResult';
import { buildPptx } from './buildPptx';
import styles from './Tool.module.css';

export default function PdfToPowerpointTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-pdf-to-powerpoint');
  const source = usePdfSource();
  const job = useJob();
  const dpiId = useId();

  const [dpi, setDpi] = useState(150);
  const [textBoxes, setTextBoxes] = useState(false);
  const dpiOptions = [
    { value: '100', label: t('100 DPI (smaller file)') },
    { value: '150', label: t('150 DPI (balanced)') },
    { value: '200', label: t('200 DPI (sharper)') },
  ];

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
    job.run((setProgress) => buildPptx(doc, file, { dpi, textBoxes, onProgress: setProgress }));
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}.pptx` : 'slides.pptx';
  const total = source.pages.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Every page becomes a slide that matches the page shape.')}
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
              summary={t('{pageCount} {pageUnit} became {slideCount} {slideUnit}.', {
                pageCount: total,
                pageUnit: total === 1 ? t('page') : t('pages'),
                slideCount: total,
                slideUnit: total === 1 ? t('slide') : t('slides'),
              })}
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
                    <Field label={t('Image quality')} hint={t('Higher DPI keeps small text crisp but makes a larger file.')}>
                      <Select
                        id={dpiId}
                        value={String(dpi)}
                        onChange={(e) => setDpi(Number(e.target.value))}
                        options={dpiOptions}
                        disabled={job.status === 'running'}
                      />
                    </Field>

                    <details className="tool-options">
                      <summary>{t('Export options')}</summary>
                      <div className="tool-options-body">
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={textBoxes}
                            disabled={job.status === 'running'}
                            onChange={(e) => setTextBoxes(e.target.checked)}
                          />
                          <span>
                            {t('Add editable text boxes')}
                            <small>{t('Text is removed from the slide image to avoid showing it twice.')}</small>
                          </span>
                        </label>
                      </div>
                    </details>
                  </div>
                </div>

                {job.status === 'running' ? (
                  <ProgressBar value={job.progress} label={t('Building slides…')} />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="primary" onClick={handleConvert}>
                      {t('Convert to PPTX')}
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
