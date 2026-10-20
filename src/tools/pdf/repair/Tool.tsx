import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
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

const LOCKED_MESSAGE = 'This PDF is password protected. Remove the password with the Unlock PDF tool first.';

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
          if (err instanceof QpdfError && err.badPassword) throw new Error(LOCKED_MESSAGE);
          // try the next method
        }
      }

      setProgress(0.2);
      let doc;
      try {
        doc = await loadPdfDocument(source);
      } catch (err) {
        if (err instanceof Error && err.name === 'PasswordException') throw new Error(LOCKED_MESSAGE);
        throw new Error(
          `This PDF is too damaged to repair: ${err instanceof Error ? err.message : 'no pages could be read.'}`
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
          label="Choose a damaged PDF or drag it here"
          hint="Your PDF stays in this browser tab. Nothing is uploaded."
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : job.status === 'done' && job.result ? (
        <div>
          <div className="meta-chips">
            <span className="meta-chip">
              Method: <strong>{METHOD_LABELS[method]}</strong>
            </span>
          </div>
          {method === 'render' && (
            <div className="error-banner" role="note">
              qpdf could not rebuild this file, so each page was rendered as an image. The pages look the same, but
              text can no longer be selected or searched.
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
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              File: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>{formatBytes(file.size)}</strong>
            </span>
          </div>

          <p className="field-hint">
            The tool first rewrites the file structure and keeps text and images intact. If that fails, it renders each
            readable page as an image and builds a new PDF.
          </p>

          {job.status === 'running' ? (
            <ProgressBar value={job.progress} label="Repairing…" />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={reset}>
                Choose a different file
              </Button>
              <Button variant="primary" onClick={run}>
                Repair PDF
              </Button>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
