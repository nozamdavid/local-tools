import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { downloadBlob } from '../../../lib/download';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { pdfToMarkdown } from '../_text/toMarkdown';
import styles from './Tool.module.css';

export default function PdfToMarkdownTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-pdf-to-markdown');
  const source = usePdfSource();

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setMarkdown(null);
    setError(null);
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    setMarkdown(null);
    setError(null);
    setProgress(0);
  };

  const handleConvert = async () => {
    if (!source.doc) return;
    setRunning(true);
    setError(null);
    setMarkdown(null);
    setProgress(0);

    try {
      const text = await pdfToMarkdown(source.doc, (done, total) => setProgress(done / total));
      if (text.trim() === '') {
        setError('No text found in this PDF. It may be a scan; run it through OCR PDF first.');
      } else {
        setMarkdown(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert the PDF.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    if (markdown === null) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copying is blocked by the browser. Select the text and copy it manually.');
    }
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}.md` : 'document.md';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Headings, lists, paragraphs and links become Markdown.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {error && <div className="error-banner">{t(error)}</div>}

          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('File:')} <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                {t('Size:')} <strong>{formatBytes(file.size)}</strong>
              </span>
              {source.doc && (
                <span className="meta-chip">
                  {t('Pages:')} <strong>{source.pages.length}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleReset}>
              {t('Change PDF')}
            </Button>
          </div>

          {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}

          {running && <ProgressBar value={progress} label={t('Extracting text…')} />}

          {source.doc && markdown === null && !running && (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="primary" onClick={handleConvert}>
                {t('Convert to Markdown')}
              </Button>
            </div>
          )}

          {markdown !== null && (
            <div className={styles.output}>
              <textarea
                className={styles.preview}
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                spellCheck={false}
                aria-label={t('Markdown output')}
              />
              <div className="action-buttons">
                <Button variant="secondary" onClick={handleReset}>
                  {t('Start over')}
                </Button>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? t('Copied') : t('Copy')}
                </Button>
                <Button variant="primary" onClick={() => downloadBlob(new Blob([markdown], { type: 'text/markdown' }), outName)}>
                  {t('Download {file}', { file: outName })}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
