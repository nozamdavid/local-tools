import { useId, useMemo, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { zipFiles } from '../../../lib/zip';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { ZipResult } from '../_pages/ZipResult';
import { usePdfPages } from '../_pages/usePdfPages';
import { baseName, copyPagesToPdf, expandRange, parseRanges, pdfToBlob } from '../_pages/pdfPages';
import styles from './Tool.module.css';

type SplitMode = 'ranges' | 'every-n' | 'each';

interface SplitResultState {
  items: { name: string; blob: Blob }[];
  zip: Blob | null;
  base: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export default function SplitPdfTool() {
  const meta = getToolMeta('pdf-split');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SplitMode>('ranges');
  const [rangeText, setRangeText] = useState('');
  const [everyN, setEveryN] = useState(2);
  const [result, setResult] = useState<SplitResultState | null>(null);

  const pdf = usePdfPages(file, false);
  const job = useJob();
  const modeId = useId();
  const rangesId = useId();
  const everyId = useId();

  // Each entry is the list of 1-based pages that become one output file.
  const plan = useMemo<{ groups: [number, number][]; error: string | null }>(() => {
    const total = pdf.pageCount;
    if (!pdf.doc || total === 0) return { groups: [], error: null };

    if (mode === 'each') {
      return { groups: Array.from({ length: total }, (_, i) => [i + 1, i + 1] as [number, number]), error: null };
    }

    if (mode === 'every-n') {
      const n = Math.floor(everyN);
      if (!Number.isFinite(n) || n < 1) return { groups: [], error: 'Enter a whole number of pages, 1 or more.' };
      const groups: [number, number][] = [];
      for (let from = 1; from <= total; from += n) groups.push([from, Math.min(from + n - 1, total)]);
      return { groups, error: null };
    }

    if (rangeText.trim() === '') return { groups: [], error: null };
    try {
      return { groups: parseRanges(rangeText, total), error: null };
    } catch (err) {
      return { groups: [], error: err instanceof Error ? err.message : 'Invalid range.' };
    }
  }, [pdf.doc, pdf.pageCount, mode, rangeText, everyN]);

  const reset = () => {
    setFile(null);
    setResult(null);
    job.reset();
  };

  const run = () => {
    const doc = pdf.doc;
    if (!doc || !file || plan.groups.length === 0) return;
    const base = baseName(file.name);
    const groups = plan.groups;
    const width = String(pdf.pageCount).length;

    job.run(async (setProgress) => {
      const items: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < groups.length; i++) {
        setProgress(i / groups.length);
        const [from, to] = groups[i];
        const out = await copyPagesToPdf(doc, expandRange([from, to]));
        const label = from === to ? `pages-${pad(from, width)}` : `pages-${pad(from, width)}-${pad(to, width)}`;
        items.push({ name: `${base}-${label}.pdf`, blob: await pdfToBlob(out) });
      }

      if (items.length === 1) {
        setResult({ items, zip: null, base });
        return items[0].blob;
      }

      const zip = await zipFiles(items);
      setResult({ items, zip, base });
      return zip;
    });
  };

  const outputCount = plan.groups.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-split">
      {pdf.password && <PasswordDialog reason={pdf.password.reason} onSubmit={pdf.password.submit} onCancel={reset} />}

      {!file ? (
        <FileDrop accept="application/pdf,.pdf" label="Choose a PDF file or drag it here" onFiles={(files) => setFile(files[0] ?? null)} />
      ) : job.status === 'done' && job.result && result ? (
        result.zip ? (
          <ZipResult zip={result.zip} zipName={`${result.base}-split.zip`} items={result.items} onReset={reset} />
        ) : (
          <PdfPreview
            blob={result.items[0].blob}
            filename={result.items[0].name}
            pageCount={plan.groups[0] ? plan.groups[0][1] - plan.groups[0][0] + 1 : undefined}
            onReset={reset}
          />
        )
      ) : (
        <div>
          {pdf.error && <div className="error-banner">{pdf.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className={styles.header}>
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
            <div>
              <Field label="Split method">
                <Select
                  id={modeId}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as SplitMode)}
                  options={[
                    { value: 'ranges', label: 'Custom page ranges' },
                    { value: 'every-n', label: 'Every N pages' },
                    { value: 'each', label: 'Every page as its own file' },
                  ]}
                />
              </Field>

              {mode === 'ranges' && (
                <Field label="Page ranges" hint="Separate ranges with commas. Each range becomes its own PDF, for example 1-3, 5, 7-9.">
                  <input
                    id={rangesId}
                    type="text"
                    className={styles.textInput}
                    aria-label="Page ranges"
                    placeholder="1-3, 5, 7-9"
                    value={rangeText}
                    onChange={(e) => setRangeText(e.target.value)}
                  />
                </Field>
              )}

              {mode === 'every-n' && (
                <Field label="Pages per file" hint="The last file holds the remaining pages.">
                  <input
                    id={everyId}
                    type="number"
                    min={1}
                    max={pdf.pageCount}
                    className={styles.textInput}
                    aria-label="Pages per file"
                    value={everyN}
                    onChange={(e) => setEveryN(Number(e.target.value))}
                  />
                </Field>
              )}

              {plan.error && <div className="error-banner">{plan.error}</div>}
              {!plan.error && outputCount > 0 && (
                <p className="field-hint">
                  {outputCount === 1 ? 'This will create 1 PDF.' : `This will create ${outputCount} PDFs, delivered as one ZIP.`}
                </p>
              )}

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Splitting PDF…" />
              ) : (
                <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                  <Button variant="secondary" onClick={reset}>
                    Choose different file
                  </Button>
                  <Button variant="primary" onClick={run} disabled={outputCount === 0 || plan.error !== null}>
                    Split PDF
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
