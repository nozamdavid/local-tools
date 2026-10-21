import { useId, useRef, useState } from 'react';
import { StandardFonts } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { OCR_LANGUAGES, addTextLayer, createOcrWorker, pageHasText, renderPageForOcr, type OcrWorker } from './ocrEngine';
import styles from './Tool.module.css';

type PageState = 'pending' | 'working' | 'done' | 'skipped' | 'empty';

const DPI_OPTIONS = [
  { value: '300', label: '300 DPI (best accuracy)' },
  { value: '200', label: '200 DPI (faster)' },
  { value: '150', label: '150 DPI (fastest)' },
];

const STATE_LABEL: Record<PageState, string> = {
  pending: 'Waiting',
  working: 'Reading…',
  done: 'Done',
  skipped: 'Has text',
  empty: 'No text found',
};

export default function OcrTool() {
  const meta = getToolMeta('pdf-ocr');
  const source = usePdfSource();
  const job = useJob();
  const langId = useId();
  const dpiId = useId();

  const [language, setLanguage] = useState('eng');
  const [dpi, setDpi] = useState(300);
  const [skipText, setSkipText] = useState(true);
  const [pageStates, setPageStates] = useState<PageState[]>([]);
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const cancelled = useRef(false);

  const total = source.pages.length;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setPageStates([]);
    setText('');
    await source.open(files[0]);
  };

  const handleReset = () => {
    cancelled.current = true;
    source.reset();
    job.reset();
    setPageStates([]);
    setText('');
    setStatus('');
  };

  const setPageState = (index: number, state: PageState) => setPageStates((prev) => prev.map((s, i) => (i === index ? state : s)));

  const handleRecognize = () => {
    const doc = source.doc;
    if (!doc) return;

    cancelled.current = false;
    setPageStates(Array.from({ length: total }, () => 'pending'));
    setText('');
    setStatus('Loading OCR engine…');

    job.run(async (setProgress) => {
      let worker: OcrWorker | null = null;
      try {
        const pdf = await source.loadForEditing();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const texts: string[] = [];
        let recognized = 0;

        for (let p = 0; p < total; p++) {
          if (cancelled.current) throw new Error('Cancelled.');
          setPageState(p, 'working');
          setStatus(`Page ${p + 1} of ${total}`);

          const existing = skipText ? await pageHasText(doc, p + 1) : null;
          if (existing !== null) {
            texts.push(existing);
            setPageState(p, 'skipped');
            setProgress((p + 1) / total);
            continue;
          }

          worker ??= await createOcrWorker(language, (s) => {
            if (s) setStatus(s.charAt(0).toUpperCase() + s.slice(1));
          });

          const rendered = await renderPageForOcr(doc, p + 1, dpi);
          const result = await worker.recognizePage(rendered.blob, (ratio) => {
            setProgress((p + ratio) / total);
            setStatus(`Page ${p + 1} of ${total}: recognizing ${Math.round(ratio * 100)}%`);
          });

          addTextLayer(pdf, p, font, rendered, result.lines);
          texts.push(result.text.trim());
          recognized++;
          setPageState(p, result.text.trim() === '' ? 'empty' : 'done');
          setProgress((p + 1) / total);
        }

        if (recognized === 0 && skipText) {
          setStatus('Every page already has a text layer; nothing needed OCR.');
        }

        setText(texts.join('\n\n'));
        const bytes = await pdf.save();
        return new Blob([bytes as BlobPart], { type: 'application/pdf' });
      } finally {
        await worker?.terminate();
      }
    });
  };

  const file = source.file;
  const base = file ? file.name.replace(/\.pdf$/i, '') : 'document';
  const running = job.status === 'running';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a scanned PDF or drag it here"
          hint="Adds a searchable text layer. Recognition runs on your device; only the language model is downloaded."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <div>
              <PdfPreview blob={job.result} filename={`${base}-ocr.pdf`} pageCount={total} onReset={handleReset} />
              <div className="action-buttons" style={{ marginTop: '1rem' }}>
                <Button variant="secondary" onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), `${base}-ocr.txt`)}>
                  Download text (.txt)
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.topRow}>
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    Size: <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {source.doc && (
                    <span className="meta-chip">
                      Pages: <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset} disabled={running}>
                  Change PDF
                </Button>
              </div>

              {source.loading && <p className={styles.status}>Opening PDF document…</p>}

              {source.doc && (
                <>
                  <div className={styles.controls}>
                    <Field label="Document language" hint="Pick the language of the text on the pages.">
                      <Select
                        id={langId}
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        options={OCR_LANGUAGES}
                        disabled={running}
                      />
                    </Field>

                    <Field label="Scan resolution" hint="Higher values read small print better but take longer.">
                      <Select
                        id={dpiId}
                        value={String(dpi)}
                        onChange={(e) => setDpi(Number(e.target.value))}
                        options={DPI_OPTIONS}
                        disabled={running}
                      />
                    </Field>
                  </div>

                  <label className={styles.check}>
                    <input type="checkbox" checked={skipText} onChange={(e) => setSkipText(e.target.checked)} disabled={running} />
                    Skip pages that already contain text
                  </label>

                  <div className={styles.pageGrid}>
                    {source.pages.map((page, index) => (
                      <div
                        key={index}
                        data-page={index + 1}
                        data-state={pageStates[index] ?? 'pending'}
                        className={`${styles.pageCard} ${pageStates[index] === 'working' ? styles.pageCardActive : ''}`}
                      >
                        <PageThumb src={source.thumbs[index]} width={page.width} height={page.height} alt={`Page ${index + 1}`} />
                        <span className={styles.pageLabel}>Page {index + 1}</span>
                        {pageStates[index] && <span className={styles.pageState}>{STATE_LABEL[pageStates[index]]}</span>}
                      </div>
                    ))}
                  </div>

                  {running ? (
                    <div>
                      <ProgressBar value={job.progress} label={status || 'Running OCR…'} />
                      <div className="action-buttons" style={{ marginTop: '1rem' }}>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            cancelled.current = true;
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button variant="primary" onClick={handleRecognize}>
                        Run OCR on {total} {total === 1 ? 'page' : 'pages'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
