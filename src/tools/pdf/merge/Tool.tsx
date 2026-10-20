import { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { loadPdfDocument, renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import {
  copyPagesToPdf,
  expandRange,
  openPdf,
  pdfToBlob,
  PasswordRequiredError,
  IncorrectPasswordError,
} from '../_pages/pdfPages';
import styles from './Tool.module.css';

interface Entry {
  id: number;
  file: File;
  pageCount?: number;
  thumb?: string;
  error?: string;
  password?: string;
  isEncrypted?: boolean;
}

let nextId = 1;

export default function MergePdfTool() {
  const meta = getToolMeta('pdf-merge');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [mergedPages, setMergedPages] = useState(0);
  const [pendingPassword, setPendingPassword] = useState<{
    entryId: number;
    reason: number;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  const patch = (id: number, change: Partial<Entry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...change } : e)));

  const inspect = async (entry: Entry, password?: string): Promise<boolean> => {
    try {
      const { pageCount } = await openPdf(entry.file, password);
      patch(entry.id, { pageCount, password, error: undefined, isEncrypted: !!password });
      try {
        const doc = await loadPdfDocument(entry.file, {
          onPassword: (verify) => {
            if (password) verify(password);
          },
        });
        const thumb = await renderPdfThumbnail(doc, 1, 120);
        void doc.loadingTask.destroy();
        patch(entry.id, { thumb });
      } catch {
        // a missing preview does not block merging
      }
      return true;
    } catch (err) {
      if (err instanceof PasswordRequiredError || err instanceof IncorrectPasswordError) {
        const bad = err instanceof IncorrectPasswordError;
        patch(entry.id, {
          isEncrypted: true,
          error: bad ? 'Incorrect password' : 'Password required',
        });
        setPendingPassword({ entryId: entry.id, reason: bad ? 2 : 1 });
        return false;
      }
      patch(entry.id, { error: err instanceof Error ? err.message : 'Failed to read the PDF.' });
      return false;
    }
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!pendingPassword) return;
    const entry = entries.find((e) => e.id === pendingPassword.entryId);
    if (!entry) {
      setPendingPassword(null);
      return;
    }
    const ok = await inspect(entry, password);
    if (ok) {
      setPendingPassword(null);
    }
  };

  const handlePasswordCancel = () => {
    setPendingPassword(null);
  };

  const addFiles = (files: File[]) => {
    const added = files.map<Entry>((file) => ({ id: nextId++, file }));
    if (added.length === 0) return;
    setEntries((prev) => [...prev, ...added]);
    job.reset();
    added.forEach((entry) => void inspect(entry));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    setEntries((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };

  const remove = (id: number) => {
    if (pendingPassword?.entryId === id) setPendingPassword(null);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const reset = () => {
    setEntries([]);
    setPendingPassword(null);
    job.reset();
  };

  const ready = entries.filter((e) => e.pageCount !== undefined && !e.error);
  const hasError = entries.some((e) => e.error);
  const loadingCount = entries.filter((e) => e.pageCount === undefined && !e.error).length;
  const totalPages = ready.reduce((sum, e) => sum + (e.pageCount ?? 0), 0);
  const totalSize = entries.reduce((sum, e) => sum + e.file.size, 0);

  const run = () => {
    job.run(async (setProgress) => {
      const out = await PDFDocument.create();
      for (let i = 0; i < entries.length; i++) {
        setProgress(i / entries.length);
        const { doc, pageCount } = await openPdf(entries[i].file, entries[i].password);
        await copyPagesToPdf(doc, expandRange([1, pageCount]), out);
      }
      setMergedPages(out.getPageCount());
      setProgress(0.95);
      return pdfToBlob(out);
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-merge">
      {pendingPassword && (
        <PasswordDialog
          reason={pendingPassword.reason}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      )}

      {entries.length === 0 ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple
          label="Choose PDF files or drag them here"
          hint="Add two or more PDFs, then set their order. Nothing is uploaded."
          onFiles={addFiles}
        />
      ) : job.status === 'done' && job.result ? (
        <PdfPreview
          blob={job.result}
          filename="merged.pdf"
          pageCount={mergedPages}
          originalSize={totalSize}
          onReset={reset}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className={styles.header}>
            <div className="meta-chips">
              <span className="meta-chip">
                Files: <strong>{entries.length}</strong>
              </span>
              <span className="meta-chip">
                Pages: <strong>{totalPages}</strong>
              </span>
              <span className="meta-chip">
                Total size: <strong>{formatBytes(totalSize)}</strong>
              </span>
            </div>
            <div className={styles.headerActions}>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                Add more PDFs
              </Button>
              <Button variant="secondary" onClick={reset}>
                Clear all
              </Button>
            </div>
          </div>

          <p className="field-hint">Drag files or use the arrows to set the order. The first file comes first.</p>

          <ol className={styles.list}>
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className={`${styles.row} ${dragFrom === index ? styles.rowDragging : ''}`}
                draggable
                onDragStart={() => setDragFrom(index)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, index);
                  setDragFrom(null);
                }}
              >
                <span className={styles.index}>{index + 1}</span>
                <div className={styles.thumb}>
                  {entry.thumb ? <img src={entry.thumb} alt="" draggable={false} /> : <span>📄</span>}
                </div>
                <div className={styles.info}>
                  <div className={styles.name} title={entry.file.name}>
                    {entry.file.name}
                  </div>
                  <div className={styles.meta}>
                    {formatBytes(entry.file.size)}
                    {entry.pageCount !== undefined && ` · ${entry.pageCount} ${entry.pageCount === 1 ? 'page' : 'pages'}`}
                    {entry.pageCount === undefined && !entry.error && ' · reading…'}
                  </div>
                  {entry.error && (
                    <div className={styles.rowError}>
                      {entry.error}
                      {entry.isEncrypted && (
                        <button
                          type="button"
                          onClick={() => setPendingPassword({ entryId: entry.id, reason: 1 })}
                          style={{
                            marginLeft: '0.6rem',
                            padding: '0.15rem 0.5rem',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            border: '1px solid currentColor',
                            background: 'transparent',
                            color: 'inherit',
                          }}
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.controls}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                    aria-label={`Move ${entry.file.name} up`}
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={index === entries.length - 1}
                    onClick={() => move(index, index + 1)}
                    aria-label={`Move ${entry.file.name} down`}
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.removeBtn}`}
                    onClick={() => remove(entry.id)}
                    aria-label={`Remove ${entry.file.name}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>

          {job.status === 'running' ? (
            <ProgressBar value={job.progress} label="Merging PDFs…" />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={reset}>
                Choose different files
              </Button>
              <Button variant="primary" onClick={run} disabled={ready.length < 2 || hasError || loadingCount > 0}>
                Merge {entries.length} PDFs
              </Button>
            </div>
          )}
          {hasError && <p className={styles.rowError}>Remove or unlock the files marked with an error to continue.</p>}
        </div>
      )}
    </ToolPage>
  );
}
