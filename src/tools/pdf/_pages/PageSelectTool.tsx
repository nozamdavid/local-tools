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
import { usePdfPages } from './usePdfPages';
import { baseName, copyPagesToPdf, pdfToBlob } from './pdfPages';

export interface PageSelectToolProps {
  toolId: 'pdf-remove-pages' | 'pdf-extract-pages';
  /** "remove" deletes the selected pages; "extract" keeps only the selected pages. */
  mode: 'remove' | 'extract';
}

/** Shared page-grid tool: pick pages, then save the PDF without them (remove) or with only them (extract). */
export function PageSelectTool({ toolId, mode }: PageSelectToolProps) {
  const meta = getToolMeta(toolId);
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [outName, setOutName] = useState('');
  const [outPages, setOutPages] = useState(0);

  const pdf = usePdfPages(file, true);
  const job = useJob();

  const reset = () => {
    setFile(null);
    setSelected(new Set());
    job.reset();
  };

  const pagesToWrite = (): number[] => {
    const all = Array.from({ length: pdf.pageCount }, (_, i) => i + 1);
    return mode === 'remove' ? all.filter((p) => !selected.has(p)) : all.filter((p) => selected.has(p));
  };

  const keepCount = mode === 'remove' ? pdf.pageCount - selected.size : selected.size;
  const emptyResult = pdf.doc !== null && keepCount === 0;

  const run = () => {
    const doc = pdf.doc;
    if (!doc || !file) return;
    const pages = pagesToWrite();
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

  const verb = mode === 'remove' ? 'Remove' : 'Extract';
  const noun = selected.size === 1 ? 'page' : 'pages';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={toolId}>
      {pdf.password && <PasswordDialog reason={pdf.password.reason} onSubmit={pdf.password.submit} onCancel={reset} />}

      {!file ? (
        <FileDrop accept="application/pdf,.pdf" label="Choose a PDF file or drag it here" onFiles={(files) => setFile(files[0] ?? null)} />
      ) : job.status === 'done' && job.result ? (
        <PdfPreview blob={job.result} filename={outName} pageCount={outPages} originalSize={file.size} onReset={reset} />
      ) : (
        <div>
          {pdf.error && <div className="error-banner">{pdf.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div className="meta-chips">
              <span className="meta-chip">
                File: <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                Size: <strong>{formatBytes(file.size)}</strong>
              </span>
              {pdf.doc && (
                <span className="meta-chip">
                  Pages: <strong>{pdf.pageCount}</strong>
                </span>
              )}
              {pdf.doc && (
                <span className="meta-chip">
                  {mode === 'remove' ? 'Marked for removal' : 'Selected'}: <strong>{selected.size}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={reset}>
              Change PDF
            </Button>
          </div>

          {pdf.loading && (
            <div style={{ margin: '2rem 0', textAlign: 'center' }}>
              <p>Opening PDF document…</p>
            </div>
          )}

          {pdf.doc && (
            <>
              <p className="field-hint">
                {mode === 'remove'
                  ? 'Click pages to mark them for deletion, or type a range. Everything else is kept.'
                  : 'Click pages to select them, or type a range. Only the selected pages go into the new PDF.'}
              </p>

              <PageSelector
                key={file.name + file.size}
                pageCount={pdf.pageCount}
                thumbs={pdf.thumbs}
                selected={selected}
                onChange={setSelected}
                tone={mode === 'remove' ? 'delete' : 'keep'}
                rangeLabel={mode === 'remove' ? 'Pages to remove' : 'Pages to extract'}
              />

              {emptyResult && selected.size > 0 && (
                <div className="error-banner">Removing every page would leave an empty PDF. Keep at least one page.</div>
              )}

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Building the new PDF…" />
              ) : (
                <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                  <Button variant="secondary" onClick={reset}>
                    Choose different file
                  </Button>
                  <Button variant="primary" onClick={run} disabled={selected.size === 0 || emptyResult}>
                    {verb} {selected.size} {noun}
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
