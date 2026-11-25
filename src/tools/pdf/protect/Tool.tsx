import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { downloadBlob } from '../../../lib/download';
import { baseName } from '../_pages/pdfPages';
import { QpdfError, runQpdf } from '../_qpdf/qpdf';
import styles from './Tool.module.css';

export default function ProtectPdfTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-protect');
  const [file, setFile] = useState<File | null>(null);
  const [userPassword, setUserPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowModify, setAllowModify] = useState(true);
  const job = useJob();

  const reset = () => {
    setFile(null);
    setUserPassword('');
    setConfirm('');
    setOwnerPassword('');
    job.reset();
  };

  const mismatch = confirm !== '' && confirm !== userPassword;
  const canRun = userPassword !== '' && userPassword === confirm;

  const run = () => {
    if (!file || !canRun) return;
    const source = file;
    // qpdf needs an owner password; without one, the open password doubles as owner password
    const args = ['--encrypt', userPassword, ownerPassword || userPassword, '256'];
    if (!allowPrint) args.push('--print=none');
    if (!allowCopy) args.push('--extract=n');
    if (!allowModify) args.push('--modify=none');
    args.push('--');

    job.run(async (setProgress) => {
      setProgress(0.1);
      const input = new Uint8Array(await source.arrayBuffer());
      setProgress(0.3);
      try {
        const output = await runQpdf(input, args);
        return new Blob([output as BlobPart], { type: 'application/pdf' });
      } catch (err) {
        if (err instanceof QpdfError) {
          throw new Error(
            err.badPassword
              ? t('This PDF is already password protected. Remove the password with the Unlock PDF tool first.')
              : t('Could not protect this PDF: {message}', { message: err.message }),
            { cause: err },
          );
        }
        throw err;
      }
    });
  };

  const busy = job.status === 'running';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-protect">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Passwords are only used in this tab and are never stored.')}
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : job.status === 'done' && job.result ? (
        <div>
          <div className="meta-chips">
            <span className="meta-chip">
              {t('Encryption:')} <strong>AES-256</strong>
            </span>
          </div>
          <PdfPreviewLocked blob={job.result} filename={`${baseName(file.name)}-protected.pdf`} onReset={reset} />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) run();
          }}
        >
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              {t('File:')} <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              {t('Size:')} <strong>{formatBytes(file.size)}</strong>
            </span>
          </div>

          <Field label={t('Password to open the PDF')}>
            <input
              type="password"
              className={styles.input}
              value={userPassword}
              autoComplete="new-password"
              disabled={busy}
              onChange={(e) => setUserPassword(e.target.value)}
            />
          </Field>

          <Field label={t('Confirm password')}>
            <input
              type="password"
              className={styles.input}
              value={confirm}
              autoComplete="new-password"
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className={styles.mismatch}>{t('The passwords do not match.')}</p>}
          </Field>

          <Field
            label={t('Owner password (optional)')}
            hint={t('Needed to change the permissions below later. If you leave it empty, the open password is used.')}
          >
            <input
              type="password"
              className={styles.input}
              value={ownerPassword}
              autoComplete="new-password"
              disabled={busy}
              onChange={(e) => setOwnerPassword(e.target.value)}
            />
          </Field>

          <Field
            label={t('Permissions')}
            hint={t('Viewers that follow the PDF rules will block the actions you untick. Opening the file always needs the password.')}
          >
            <div className={styles.checks}>
              <label className="checkbox-label">
                <input type="checkbox" checked={allowPrint} disabled={busy} onChange={(e) => setAllowPrint(e.target.checked)} />
                {t('Allow printing')}
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={allowCopy} disabled={busy} onChange={(e) => setAllowCopy(e.target.checked)} />
                {t('Allow copying text and images')}
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={allowModify} disabled={busy} onChange={(e) => setAllowModify(e.target.checked)} />
                {t('Allow modifying')}
              </label>
            </div>
          </Field>

          {busy ? (
            <ProgressBar value={job.progress} label={t('Encrypting…')} />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button type="button" variant="secondary" onClick={reset}>
                {t('Choose a different file')}
              </Button>
              <Button type="submit" variant="primary" disabled={!canRun}>
                {t('Protect PDF')}
              </Button>
            </div>
          )}
        </form>
      )}
    </ToolPage>
  );
}

/** The encrypted file cannot be previewed without its password, so only offer the download. */
function PdfPreviewLocked({ blob, filename, onReset }: { blob: Blob; filename: string; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="result-panel">
      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">{t('Output file')}</span>
          <span className="stat-value" style={{ fontSize: '0.95rem' }}>
            {filename}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">{t('Output size')}</span>
          <span className="stat-value">{formatBytes(blob.size)}</span>
        </div>
      </div>
      <div className="action-buttons">
        <Button variant="secondary" onClick={onReset}>
          {t('Start over')}
        </Button>
        <Button variant="primary" onClick={() => downloadBlob(blob, filename)}>
          {t('Download {file}', { file: filename })}
        </Button>
      </div>
    </div>
  );
}
