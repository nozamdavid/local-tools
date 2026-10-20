import { useEffect, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { baseName } from '../_pages/pdfPages';
import { QpdfError, decryptPdf, isEncryptedPdf } from '../_qpdf/qpdf';
import styles from './Tool.module.css';

type Inspection = 'checking' | 'encrypted' | 'plain' | 'unreadable';

export default function UnlockPdfTool() {
  const meta = getToolMeta('pdf-unlock');
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection>('checking');
  const [inspectError, setInspectError] = useState('');
  const [password, setPassword] = useState('');
  const job = useJob();

  useEffect(() => {
    if (!file) return;
    let active = true;
    setInspection('checking');
    setInspectError('');

    file
      .arrayBuffer()
      .then((buffer) => isEncryptedPdf(new Uint8Array(buffer)))
      .then((encrypted) => {
        if (active) setInspection(encrypted ? 'encrypted' : 'plain');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setInspection('unreadable');
        setInspectError(err instanceof Error ? err.message : 'Failed to read the PDF.');
      });

    return () => {
      active = false;
    };
  }, [file]);

  const reset = () => {
    setFile(null);
    setPassword('');
    job.reset();
  };

  const run = () => {
    if (!file) return;
    const source = file;
    const pass = password;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const input = new Uint8Array(await source.arrayBuffer());
      setProgress(0.3);
      try {
        const output = await decryptPdf(input, pass);
        return new Blob([output as BlobPart], { type: 'application/pdf' });
      } catch (err) {
        if (err instanceof QpdfError) {
          throw new Error(
            err.badPassword
              ? pass
                ? 'Incorrect password. Check it and try again.'
                : 'This PDF needs a password to open. Enter it above.'
              : `Could not unlock this PDF: ${err.message}`
          );
        }
        throw err;
      }
    });
  };

  const busy = job.status === 'running';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-unlock">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a protected PDF or drag it here"
          hint="Your PDF and password stay in this browser tab. Nothing is uploaded."
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : job.status === 'done' && job.result ? (
        <PdfPreview
          blob={job.result}
          filename={`${baseName(file.name)}-unlocked.pdf`}
          originalSize={file.size}
          onReset={reset}
        />
      ) : (
        <div>
          {inspection === 'unreadable' && <div className="error-banner">Could not read this PDF: {inspectError}</div>}
          {inspection === 'plain' && (
            <div className="error-banner" role="status">
              This PDF is not password protected, so there is nothing to remove.
            </div>
          )}
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              File: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>{formatBytes(file.size)}</strong>
            </span>
            {inspection === 'checking' && <span className="meta-chip">Checking…</span>}
            {inspection === 'encrypted' && (
              <span className="meta-chip">
                Status: <strong>Encrypted</strong>
              </span>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inspection === 'encrypted' && !busy) run();
            }}
          >
            <Field
              label="Password"
              hint="Leave this empty if the PDF opens without a password but restricts printing, copying or editing."
            >
              <input
                type="password"
                className={styles.input}
                value={password}
                autoComplete="off"
                placeholder="Enter the PDF password"
                disabled={busy || inspection !== 'encrypted'}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {busy ? (
              <ProgressBar value={job.progress} label="Removing password…" />
            ) : (
              <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                <Button type="button" variant="secondary" onClick={reset}>
                  Choose a different file
                </Button>
                <Button type="submit" variant="primary" disabled={inspection !== 'encrypted'}>
                  Unlock PDF
                </Button>
              </div>
            )}
          </form>
        </div>
      )}
    </ToolPage>
  );
}
