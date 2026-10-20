import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { DownloadResult } from '../_layout/DownloadResult';
import { buildDocx } from './buildDocx';
import styles from './Tool.module.css';

export default function PdfToWordTool() {
  const meta = getToolMeta('pdf-pdf-to-word');
  const source = usePdfSource();
  const job = useJob();

  const [exactLayout, setExactLayout] = useState(false);

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
    job.run((setProgress) => buildDocx(doc, file, { exactLayout, onProgress: setProgress }));
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}.docx` : 'document.docx';
  const total = source.pages.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && (
        <PasswordDialog
          reason={source.password.reason}
          onSubmit={source.password.submit}
          onCancel={handleReset}
        />
      )}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Paragraphs, headings and tables become an editable DOCX."
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
              summary={`${total} ${total === 1 ? 'page' : 'pages'} converted${exactLayout ? ' as page images' : ' to editable text'}.`}
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
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={exactLayout}
                        disabled={job.status === 'running'}
                        onChange={(e) => setExactLayout(e.target.checked)}
                      />
                      <span>
                        Keep exact layout (page images)
                        <small>
                          Each page is embedded as a picture, so it looks identical but the text is not editable.
                        </small>
                      </span>
                    </label>
                  </div>
                </div>

                {job.status === 'running' ? (
                  <ProgressBar value={job.progress} label="Converting to Word…" />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="primary" onClick={handleConvert}>
                      Convert to DOCX
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
