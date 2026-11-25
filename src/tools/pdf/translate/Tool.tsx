import { useState, useRef, useId, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { copyText } from '../../../lib/clipboard';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { chunkTextForInference, TRANSLATION_PAIRS, AiJob } from '../_ai';
import { usePdfText } from '../_ai/usePdfText';
import { translateAiProgressLabel } from '../_ai/progress';
import styles from './Tool.module.css';

export default function TranslateTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-translate');
  const source = usePdfSource();

  const pairSelectId = useId();
  const scopeSelectId = useId();

  const [selectedPairId, setSelectedPairId] = useState<string>(TRANSLATION_PAIRS[0].id);
  const [pageScope, setPageScope] = useState<string>('all');

  const { extracting, error: extractionError, result: extractionResult } = usePdfText(source.doc);

  const [running, setRunning] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [translation, setTranslation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeJob = useRef<AiJob | null>(null);
  useEffect(() => () => activeJob.current?.abort(), []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    handleReset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    if (activeJob.current) {
      activeJob.current.abort();
      activeJob.current = null;
    }
    source.reset();
    setRunning(false);
    setProgressRatio(0);
    setProgressLabel('');
    setTranslation(null);
    setError(null);
    setCopied(false);
  };

  const currentPair = TRANSLATION_PAIRS.find((p) => p.id === selectedPairId) ?? TRANSLATION_PAIRS[0];

  const handleTranslate = async () => {
    if (!extractionResult || !extractionResult.hasText) return;

    setRunning(true);
    setError(null);
    setTranslation(null);
    setProgressRatio(0);
    setProgressLabel('Preparing translation model...');

    try {
      const maxPages = pageScope === '3' ? 3 : pageScope === '5' ? 5 : pageScope === '10' ? 10 : undefined;

      const pagesToUse = maxPages ? extractionResult.pages.slice(0, maxPages) : extractionResult.pages;
      const chunks = chunkTextForInference(pagesToUse, {
        maxChunkChars: 1200,
        includePageHeaders: true,
        maxTotalChunks: 15,
      });

      if (chunks.length === 0) {
        throw new Error('No text found to translate.');
      }

      const job = new AiJob();
      activeJob.current = job;

      const chunkTexts = chunks.map((c) => c.text);
      const res = await job.translate(chunkTexts, currentPair.modelId, {
        onProgress: (p) => {
          if (p.phase === 'downloading') {
            setProgressRatio(p.progress * 0.6);
            setProgressLabel(p.label);
          } else {
            const fraction = p.totalItems ? (p.current ?? 1) / p.totalItems : 1;
            setProgressRatio(0.6 + fraction * 0.4);
            setProgressLabel(p.label);
          }
        },
      });

      setTranslation(res);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('cancelled')) {
        // User cancelled intentionally
      } else {
        setError(err instanceof Error ? err.message : 'Translation failed.');
      }
    } finally {
      activeJob.current = null;
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    if (!translation) return;
    try {
      await copyText(translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setError('Unable to copy automatically. Please select the text and copy manually.');
    }
  };

  const handleDownload = () => {
    if (!translation || !source.file) return;
    const baseName = source.file.name.replace(/\.[^/.]+$/, '');
    downloadBlob(new Blob([translation], { type: 'text/plain;charset=utf-8' }), `${baseName}-${currentPair.targetLang}.txt`);
  };

  const file = source.file;
  const pairOptions = TRANSLATION_PAIRS.map((p) => ({
    value: p.id,
    label: `${t(p.label)} (${p.sizeEstimate})`,
  }));

  const scopeOptions = [
    { value: 'all', label: t('All pages ({count} pages)', { count: source.pages.length }) },
    { value: '3', label: t('First {count} pages', { count: 3 }) },
    { value: '5', label: t('First {count} pages', { count: 5 }) },
    { value: '10', label: t('First {count} pages', { count: 10 }) },
  ];

  const originalWords = extractionResult?.totalWords ?? 0;
  const translatedWords = translation ? translation.split(/\s+/).filter(Boolean).length : 0;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Translates PDF text locally on your device with on-device AI. Outputs plain translated text.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {extractionError && <div className="error-banner">{t(extractionError)}</div>}
          {error && <div className="error-banner">{t(error)}</div>}

          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('File:')} <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                {t('Size:')} <strong>{formatBytes(file.size)}</strong>
              </span>
              {source.pages.length > 0 && (
                <span className="meta-chip">
                  {t('Pages:')} <strong>{source.pages.length}</strong>
                </span>
              )}
              {extractionResult && (
                <span className="meta-chip">
                  {t('Words:')} <strong>{extractionResult.totalWords}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleReset} disabled={running}>
              {t('Change PDF')}
            </Button>
          </div>

          {(source.loading || extracting) && (
            <p className="status-text">{source.loading ? t('Opening PDF document...') : t('Extracting document text...')}</p>
          )}

          {extractionResult && !extractionResult.hasText && !extracting && (
            <div className={styles.ocrNotice}>
              <div className={styles.ocrNoticeTitle}>{t('No selectable text found')}</div>
              <p className={styles.ocrNoticeDesc}>
                {t(
                  'This PDF appears to be a scanned document or contains only images with no embedded text layer. Local translation requires machine-readable text. Please process this PDF with the OCR PDF tool first to recognize and extract its text.',
                )}
              </p>
              <div className="action-buttons" style={{ justifyContent: 'center' }}>
                <a href="/pdf/ocr" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                  {t('Go to OCR PDF')}
                </a>
              </div>
            </div>
          )}

          {extractionResult && extractionResult.hasText && !translation && !running && (
            <div>
              <div className={styles.controls}>
                <Field
                  label={t('Language pair')}
                  hint={t('Model: {model} ({size})', { model: currentPair.modelId, size: currentPair.sizeEstimate })}
                >
                  <Select
                    id={pairSelectId}
                    value={selectedPairId}
                    onChange={(e) => setSelectedPairId(e.target.value)}
                    options={pairOptions}
                  />
                </Field>

                {source.pages.length > 3 && (
                  <Field label={t('Page scope')} hint={t('Select how many pages to include in the translation.')}>
                    <Select id={scopeSelectId} value={pageScope} onChange={(e) => setPageScope(e.target.value)} options={scopeOptions} />
                  </Field>
                )}
              </div>

              <div className={styles.noticeBox}>
                🔒 <strong>{t('100% private and in your browser:')}</strong>{' '}
                {t(
                  'Translation models execute entirely on your device using WebAssembly. Model weights are downloaded directly from Hugging Face and cached in your browser. No document text or metadata is ever transmitted over the network.',
                )}
                <br />
                <small style={{ marginTop: '0.4rem', display: 'block' }}>
                  {t('Note: Output is formatted plain text with page and paragraph demarcations preserved.')}
                </small>
              </div>

              <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Reset')}
                </Button>
                <Button variant="primary" onClick={handleTranslate}>
                  {t('Translate document')}
                </Button>
              </div>
            </div>
          )}

          {running && (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar value={progressRatio} label={translateAiProgressLabel(progressLabel || 'Translating document...', t)} />
              <div className="action-buttons" style={{ marginTop: '1rem' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (activeJob.current) {
                      activeJob.current.abort();
                      activeJob.current = null;
                    }
                    setRunning(false);
                  }}
                >
                  {t('Cancel')}
                </Button>
              </div>
            </div>
          )}

          {translation && !running && (
            <div className={styles.outputArea}>
              <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>{t('Translated text')}</h3>
              <textarea
                className={styles.outputTextarea}
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                aria-label={t('Translated output')}
              />

              <div className={styles.statsBar}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>{t('Original words')}</span>
                  <span className={styles.statVal}>{originalWords}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>{t('Translated words')}</span>
                  <span className={styles.statVal}>{translatedWords}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>{t('Target language')}</span>
                  <span className={styles.statVal} style={{ textTransform: 'uppercase' }}>
                    {currentPair.targetLang}
                  </span>
                </div>
              </div>

              <div className="action-buttons" style={{ marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Start over')}
                </Button>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? t('Copied!') : t('Copy translated text')}
                </Button>
                <Button variant="primary" onClick={handleDownload}>
                  {t('Download text (.txt)')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
