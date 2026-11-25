import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { loadPdfDocument } from '../../image/_pdf/pdfRenderer';
import { baseName } from '../_pages/pdfPages';
import { QpdfError, runQpdf } from '../_qpdf/qpdf';
import { rasterizePdf } from '../_qpdf/rasterize';
import { rebuildXref } from '../_qpdf/rebuildXref';

type Method = 'qpdf' | 'rebuilt' | 'render';

const METHOD_LABELS: Record<Method, string> = {
  qpdf: 'File structure rewritten (qpdf)',
  rebuilt: 'Cross-reference table rebuilt, then rewritten (qpdf)',
  render: 'Pages rendered and rebuilt (pdf.js)',
};

/** Opens the bytes with pdf.js and returns the page count; throws if no page can be read. */
async function countReadablePages(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdfDocument(new Blob([bytes as BlobPart]));
  try {
    if (doc.numPages < 1) throw new Error('no pages');
    await doc.getPage(1);
    return doc.numPages;
  } finally {
    void doc.loadingTask.destroy();
  }
}

export default function RepairPdfTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-repair');
  const [file, setFile] = useState<File | null>(null);
  const [method, setMethod] = useState<Method>('qpdf');
  const [pageCount, setPageCount] = useState(0);
  const job = useJob();

  const reset = () => {
    setFile(null);
    job.reset();
  };

  const run = () => {
    if (!file) return;
    const source = file;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const input = new Uint8Array(await source.arrayBuffer());

      // The WASM build of qpdf cannot reconstruct a broken xref on its own, so the second
      // attempt rebuilds the xref table first and hands the result to qpdf.
      const attempts: { method: Method; prepare: (bytes: Uint8Array) => Uint8Array }[] = [
        { method: 'qpdf', prepare: (bytes) => bytes },
        { method: 'rebuilt', prepare: rebuildXref },
      ];

      for (const [index, attempt] of attempts.entries()) {
        try {
          const output = await runQpdf(attempt.prepare(input), []);
          setProgress(0.3 + index * 0.2);
          const pages = await countReadablePages(output);
          setMethod(attempt.method);
          setPageCount(pages);
          return new Blob([output as BlobPart], { type: 'application/pdf' });
        } catch (err) {
          if (err instanceof QpdfError && err.badPassword)
            throw new Error(t('This PDF is password protected. Remove the password with the Unlock PDF tool first.'), { cause: err });
          // try the next method
        }
      }

      setProgress(0.2);
      let doc;
      try {
        doc = await loadPdfDocument(source);
      } catch (err) {
        if (err instanceof Error && err.name === 'PasswordException')
          throw new Error(t('This PDF is password protected. Remove the password with the Unlock PDF tool first.'), { cause: err });
        throw new Error(
          t('This PDF is too damaged to repair: {detail}', { detail: err instanceof Error ? err.message : t('no pages could be read.') }),
          {
            cause: err,
          },
        );
      }

      try {
        const output = await rasterizePdf(doc, {
          dpi: 150,
          quality: 0.85,
          onProgress: (ratio) => setProgress(0.2 + ratio * 0.75),
        });
        setMethod('render');
        setPageCount(doc.numPages);
        return new Blob([output as BlobPart], { type: 'application/pdf' });
      } finally {
        void doc.loadingTask.destroy();
      }
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-repair">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a damaged PDF or drag it here')}
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : job.status === 'done' && job.result ? (
        <div>
          <div className="meta-chips">
            <span className="meta-chip">
              {t('Method:')} <strong>{t(METHOD_LABELS[method])}</strong>
            </span>
          </div>
          {method === 'render' && (
            <div className="error-banner" role="note">
              {t(
                'qpdf could not rebuild this file, so each page was rendered as an image. The pages look the same, but text can no longer be selected or searched.',
              )}
            </div>
          )}
          <PdfPreview
            blob={job.result}
            filename={`${baseName(file.name)}-repaired.pdf`}
            pageCount={pageCount}
            originalSize={file.size}
            onReset={reset}
          />
        </div>
      ) : (
        <div>
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              {t('File:')} <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              {t('Size:')} <strong>{formatBytes(file.size)}</strong>
            </span>
          </div>

          <p className="field-hint">
            {t(
              'The tool first rewrites the file structure and keeps text and images intact. If that fails, it renders each readable page as an image and builds a new PDF.',
            )}
          </p>

          {job.status === 'running' ? (
            <ProgressBar value={job.progress} label={t('Repairing…')} />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={reset}>
                {t('Choose a different file')}
              </Button>
              <Button variant="primary" onClick={run}>
                {t('Repair PDF')}
              </Button>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
