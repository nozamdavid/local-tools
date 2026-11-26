import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageSelector } from './PageSelector';
import { PageToolNav } from './PageToolNav';
import { usePdfPages } from './usePdfPages';
import { baseName, copyPagesToPdf, expandRange, parseRanges, pdfToBlob } from './pdfPages';
import { useI18n } from '../../../lib/i18n';

export interface PageSelectToolProps {
  toolId: 'pdf-remove-pages' | 'pdf-extract-pages';
  /** "remove" deletes the selected pages; "extract" keeps only the selected pages. */
  mode: 'remove' | 'extract';
}

/** Shared page-grid tool: pick pages, then save the PDF without them (remove) or with only them (extract). */
export function PageSelectTool({ toolId, mode }: PageSelectToolProps) {
  const { t } = useI18n();
  const meta = getToolMeta(toolId);
  const [file, setFile] = useState<File | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [outName, setOutName] = useState('');
  const [outPages, setOutPages] = useState(0);

  const pdf = usePdfPages(file, true);
  const job = useJob();

  const reset = () => {
    setFile(null);
    setRangeText('');
    job.reset();
  };

  const selected = new Set<number>();
  let rangeError: string | null = null;
  if (pdf.doc && rangeText.trim()) {
    try {
      for (const range of parseRanges(rangeText, pdf.pageCount)) {
        for (const page of expandRange(range)) selected.add(page);
      }
    } catch (error) {
      rangeError = error instanceof Error ? error.message : 'Invalid range.';
    }
  }

  const keepCount = mode === 'remove' ? pdf.pageCount - selected.size : selected.size;
  const emptyResult = pdf.doc !== null && keepCount === 0;

  const run = () => {
    const doc = pdf.doc;
    if (!doc || !file || rangeError || selected.size === 0) return;
    const all = Array.from({ length: pdf.pageCount }, (_, i) => i + 1);
    const pages = all.filter((page) => (mode === 'extract' ? selected.has(page) : !selected.has(page)));
    if (pages.length === 0) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const out = await copyPagesToPdf(doc, pages);
      setProgress(0.7);
      const blob = await pdfToBlob(out);
      setOutName(`${baseName(file.name)}-${mode === 'remove' ? 'removed' : 'extracted'}.pdf`);
      setOutPages(pages.length);
      return blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={toolId}>
      <PageToolNav currentId={toolId} />
      {pdf.password && <PasswordDialog reason={pdf.password.reason} onSubmit={pdf.password.submit} onCancel={reset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : job.status === 'done' && job.result ? (
        <PdfPreview blob={job.result} filename={outName} pageCount={outPages} originalSize={file.size} onReset={reset} />
      ) : (
        <div>
          {pdf.error && <div className="error-banner">{t(pdf.error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('File:')} <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                {t('Size:')} <strong>{formatBytes(file.size)}</strong>
              </span>
              {pdf.doc && (
                <span className="meta-chip">
                  {t('Pages:')} <strong>{pdf.pageCount}</strong>
                </span>
              )}
              {pdf.doc && (
                <span className="meta-chip">
                  {t(mode === 'remove' ? 'Marked for removal' : 'Selected')}: <strong>{selected.size}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={reset}>
              {t('Change PDF')}
            </Button>
          </div>

          {pdf.loading && (
            <div style={{ margin: '2rem 0', textAlign: 'center' }}>
              <p>{t('Opening PDF document…')}</p>
            </div>
          )}

          {pdf.doc && (
            <>
              <p className="field-hint">
                {mode === 'remove'
                  ? t('Select pages to remove with the thumbnails or a page range.')
                  : t('Select pages to keep with the thumbnails or a page range.')}
              </p>

              <PageSelector
                pageCount={pdf.pageCount}
                thumbs={pdf.thumbs}
                selected={selected}
                rangeText={rangeText}
                rangeError={rangeError}
                onChange={setRangeText}
                tone={mode === 'remove' ? 'delete' : 'keep'}
                rangeLabel={mode === 'remove' ? 'Pages to remove' : 'Pages to extract'}
              />

              {emptyResult && selected.size > 0 && (
                <div className="error-banner">{t('Removing every page would leave an empty PDF. Keep at least one page.')}</div>
              )}

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Building the new PDF…')} />
              ) : (
                <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                  <Button variant="primary" onClick={run} disabled={Boolean(rangeError) || selected.size === 0 || emptyResult}>
                    {t('Save PDF')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </ToolPage>
  );
}
