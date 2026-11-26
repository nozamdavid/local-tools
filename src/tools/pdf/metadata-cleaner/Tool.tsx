import { useEffect, useState } from 'react';
import { Button } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ToolPage } from '../../../components/ToolPage';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { getToolMeta } from '../../registry';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { baseName } from '../_pages/pdfPages';
import { clearPdfMetadata, inspectPdfMetadata, type PdfMetadataCleanup, type PdfMetadataInspection } from './cleanMetadata';
import styles from './Tool.module.css';

const meta = getToolMeta('pdf-metadata-cleaner');

export default function PdfMetadataCleanerTool() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<PdfMetadataInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [cleanup, setCleanup] = useState<PdfMetadataCleanup | null>(null);
  const job = useJob();

  useEffect(() => {
    if (!file) return;
    let active = true;

    inspectPdfMetadata(file)
      .then((value) => {
        if (active) setInspection(value);
      })
      .catch((error: unknown) => {
        if (active) setInspectionError(error instanceof Error ? error.message : t('Could not read this PDF.'));
      })
      .finally(() => {
        if (active) setInspecting(false);
      });

    return () => {
      active = false;
    };
  }, [file, t]);

  const reset = () => {
    setFile(null);
    setInspection(null);
    setInspectionError(null);
    setInspecting(false);
    setCleanup(null);
    job.reset();
  };

  const selectFile = (files: File[]) => {
    const selected = files[0] ?? null;
    setFile(selected);
    setInspection(null);
    setInspectionError(null);
    setInspecting(selected !== null);
    setCleanup(null);
    job.reset();
  };

  const run = () => {
    if (!file) return;
    job.run(async () => {
      const result = await clearPdfMetadata(file);
      setCleanup(result);
      return new Blob([result.output as BlobPart], { type: 'application/pdf' });
    });
  };

  const result = job.status === 'done' ? job.result : undefined;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-metadata-cleaner">
      {!file ? (
        <FileDrop accept="application/pdf,.pdf" label={t('Choose a PDF file or drag it here')} onFiles={selectFile} />
      ) : result && cleanup ? (
        <div>
          <section className={styles.report} aria-labelledby="metadata-cleanup-report">
            <h2 id="metadata-cleanup-report">{t('Cleanup verified')}</h2>
            <p>
              <strong>{t('Removed and verified absent:')}</strong>{' '}
              {cleanup.removedFields.length > 0
                ? cleanup.removedFields.map((field) => t(field)).join(', ')
                : t('No standard Info fields were present.')}
            </p>
            <p>
              <strong>{t('Remaining listed Info fields:')}</strong> {t('None.')}
            </p>
            <p>
              <strong>{t('XMP:')}</strong>{' '}
              {cleanup.xmpMetadataPresent
                ? cleanup.xmpMetadataPresentBefore
                  ? t('An XMP metadata stream was retained and may contain identifying details.')
                  : t('An XMP metadata stream is present in the output and may contain identifying details.')
                : t('No XMP metadata stream was found in the output.')}
            </p>
            <p>
              {t(
                'Custom Info entries, attachments, and form fields are outside this cleanup. Page text, vector content, boxes, and rotation are preserved.',
              )}
            </p>
            <p>{t('If the source has digital signatures, saving this PDF invalidates them.')}</p>
          </section>
          <PdfPreview
            blob={result}
            filename={`${baseName(file.name)}-metadata-cleaned.pdf`}
            originalSize={file.size}
            pageCount={cleanup.pageCount}
            onReset={reset}
          />
        </div>
      ) : (
        <div>
          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              {t('File:')} <strong>{file.name}</strong>
            </span>
          </div>

          <section className={styles.fieldSection} aria-labelledby="metadata-fields-heading">
            <h2 id="metadata-fields-heading">{t('In-scope document-info fields present')}</h2>
            {inspecting ? (
              <ProgressBar value={0} indeterminate label={t('Reading PDF metadata…')} />
            ) : inspection ? (
              inspection.fields.length > 0 ? (
                <ul className={styles.fieldList}>
                  {inspection.fields.map((field) => (
                    <li key={field} className={styles.fieldItem}>
                      {t(field)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>{t('No in-scope document-info fields were found.')}</p>
              )
            ) : null}
            {inspection?.xmpMetadataPresent && (
              <p className={styles.xmpNote}>{t('This PDF contains an XMP stream that may include author details.')}</p>
            )}
            {inspectionError && (
              <div className="error-banner" role="alert">
                {t(inspectionError)}
              </div>
            )}
          </section>

          <div className={styles.scopeNote} role="note">
            <p>
              {t(
                'Only the listed standard Info fields are cleared. Custom Info entries, XMP metadata, attachments, and form fields are left untouched.',
              )}
            </p>
            <p>
              {t(
                'Page text, vector content, page boxes, and rotation are preserved. If this PDF is signed, saving it invalidates the digital signatures.',
              )}
            </p>
          </div>

          {job.error && (
            <div className="error-banner" role="alert">
              {t(job.error)}
            </div>
          )}

          {job.status === 'running' ? (
            <ProgressBar value={0} indeterminate label={t('Clearing and verifying metadata…')} />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={reset}>
                {t('Choose a different file')}
              </Button>
              <Button variant="primary" disabled={!inspection || inspecting} onClick={run}>
                {t('Clear metadata')}
              </Button>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
