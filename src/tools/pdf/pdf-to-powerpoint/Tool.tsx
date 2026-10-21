import { useId, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field, Select } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { DownloadResult } from '../_layout/DownloadResult';
import { buildPptx } from './buildPptx';
import styles from './Tool.module.css';

const DPI_OPTIONS = [
  { value: '100', label: '100 DPI (smaller file)' },
  { value: '150', label: '150 DPI (balanced)' },
  { value: '200', label: '200 DPI (sharper)' },
];

export default function PdfToPowerpointTool() {
  const meta = getToolMeta('pdf-pdf-to-powerpoint');
  const source = usePdfSource();
  const job = useJob();
  const dpiId = useId();

  const [dpi, setDpi] = useState(150);
  const [textBoxes, setTextBoxes] = useState(false);

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
          label="Choose a PDF file or drag it here"
          hint="Every page becomes a slide that matches the page shape."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

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
            <Button variant="secondary" onClick={handleReset}>
              Change PDF
            </Button>
          </div>

          {source.loading && <p className={styles.status}>Opening PDF document…</p>}

          {job.result ? (
            <DownloadResult
              blob={job.result}
              filename={outName}
              summary={`${total} ${total === 1 ? 'page' : 'pages'} became ${total} ${total === 1 ? 'slide' : 'slides'}.`}
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
                      alt="Page 1"
                      box={180}
                    />
                  )}

                  <div className={styles.options}>
                    <Field label="Image quality" hint="Higher DPI keeps small text crisp but makes a larger file.">
                      <Select
                        id={dpiId}
                        value={String(dpi)}
                        onChange={(e) => setDpi(Number(e.target.value))}
                        options={DPI_OPTIONS}
                        disabled={job.status === 'running'}
                      />
                    </Field>

                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={textBoxes}
                        disabled={job.status === 'running'}
                        onChange={(e) => setTextBoxes(e.target.checked)}
                      />
                      <span>
                        Add editable text boxes
                        <small>Each line of text becomes a text box and is cleared from the slide image so it does not show twice.</small>
                      </span>
                    </label>
                  </div>
                </div>

                {job.status === 'running' ? (
                  <ProgressBar value={job.progress} label="Building slides…" />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="primary" onClick={handleConvert}>
                      Convert to PPTX
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
