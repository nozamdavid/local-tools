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
import { chunkTextForInference, SUMMARIZE_MODELS, AiJob } from '../_ai';
import { usePdfText } from '../_ai/usePdfText';
import { translateAiProgressLabel } from '../_ai/progress';
import styles from './Tool.module.css';

export default function SummarizeTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-summarize');
  const source = usePdfSource();

  const modelSelectId = useId();
  const lengthSelectId = useId();
  const scopeSelectId = useId();
  const summaryNoticeId = useId();

  const [selectedModel, setSelectedModel] = useState<string>(SUMMARIZE_MODELS[0].id);
  const [summaryLength, setSummaryLength] = useState<'concise' | 'standard' | 'detailed'>('standard');
  const [pageScope, setPageScope] = useState<string>('all');

  const { extracting, error: extractionError, result: extractionResult } = usePdfText(source.doc);

  const [running, setRunning] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
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
    setSummary(null);
    setError(null);
    setCopied(false);
  };

  const handleSummarize = async () => {
    if (!extractionResult || !extractionResult.hasText) return;

    setRunning(true);
    setError(null);
    setSummary(null);
    setProgressRatio(0);
    setProgressLabel('Preparing model...');

    try {
      const maxPages = pageScope === '3' ? 3 : pageScope === '5' ? 5 : pageScope === '10' ? 10 : undefined;

      const pagesToUse = maxPages ? extractionResult.pages.slice(0, maxPages) : extractionResult.pages;
      const chunks = chunkTextForInference(pagesToUse, {
        maxChunkChars: selectedModel.includes('t5') ? 1400 : 2200,
        includePageHeaders: false,
        maxTotalChunks: 10,
      });

      if (chunks.length === 0) {
        throw new Error('No text chunks found to summarize.');
      }

      const job = new AiJob();
      activeJob.current = job;

      const maxTokens = summaryLength === 'concise' ? 80 : summaryLength === 'detailed' ? 180 : 130;
      const minTokens = summaryLength === 'concise' ? 20 : summaryLength === 'detailed' ? 50 : 30;

      const chunkSummaries: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setProgressLabel(`Processing section ${i + 1} of ${chunks.length}...`);
        const chunkText = chunks[i].text;
        const res = await job.summarize(chunkText, selectedModel, {
          maxLength: maxTokens,
          minLength: minTokens,
          onProgress: (p) => {
            if (p.phase === 'downloading') {
              setProgressRatio(p.progress * 0.7);
              setProgressLabel(p.label);
            } else {
              const chunkFraction = 1 / chunks.length;
              const base = 0.7 + i * (0.3 * chunkFraction);
              setProgressRatio(base + (p.progress || 0) * (0.3 * chunkFraction));
              setProgressLabel(p.label);
            }
          },
        });
        chunkSummaries.push(res);
      }

      setSummary(chunkSummaries.join('\n\n'));
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('cancelled')) {
        // User cancelled intentionally
      } else {
        setError(err instanceof Error ? err.message : 'Summarization failed.');
      }
    } finally {
      activeJob.current = null;
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    if (!summary) return;
    try {
      await copyText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setError('Unable to copy automatically. Please select the text and copy manually.');
    }
  };

  const handleDownload = () => {
    if (!summary || !source.file) return;
    const baseName = source.file.name.replace(/\.[^/.]+$/, '');
    downloadBlob(new Blob([summary], { type: 'text/plain;charset=utf-8' }), `${baseName}-summary.txt`);
  };

  const file = source.file;
  const currentModel = SUMMARIZE_MODELS.find((m) => m.id === selectedModel) ?? SUMMARIZE_MODELS[0];

  const modelOptions = SUMMARIZE_MODELS.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.sizeEstimate})${m.recommended ? ` - ${t('Recommended')}` : ''}`,
  }));

  const lengthOptions: { value: typeof summaryLength; label: string }[] = [
    { value: 'concise', label: t('Concise (~1-2 paragraphs)') },
    { value: 'standard', label: t('Standard overview') },
    { value: 'detailed', label: t('Detailed summary') },
  ];

  const scopeOptions = [
    { value: 'all', label: t('All pages ({count} pages)', { count: source.pages.length }) },
    { value: '3', label: t('First {count} pages', { count: 3 }) },
    { value: '5', label: t('First {count} pages', { count: 5 }) },
    { value: '10', label: t('First {count} pages', { count: 10 }) },
  ];

  const originalWords = extractionResult?.totalWords ?? 0;
  const summaryWords = summary ? summary.split(/\s+/).filter(Boolean).length : 0;
  const reductionPct =
    originalWords > 0 && summaryWords > 0 ? Math.max(0, Math.round(((originalWords - summaryWords) / originalWords) * 100)) : 0;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Summarizes PDF documents completely on your device using local WebAssembly AI.')}
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
                  'This PDF appears to be a scanned document or contains only images with no embedded text layer. Local summarization requires machine-readable text. Please process this PDF with the OCR PDF tool first to recognize and extract its text.',
                )}
              </p>
              <div className="action-buttons" style={{ justifyContent: 'center' }}>
                <a href="/pdf/ocr" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                  {t('Go to OCR PDF')}
                </a>
              </div>
            </div>
          )}

          {extractionResult && extractionResult.hasText && !summary && !running && (
            <div>
              <div className={styles.controls}>
                <Field
                  label={t('Summarization model')}
                  hint={t('Download size: {size}. Stored in browser cache.', { size: currentModel.sizeEstimate })}
                >
                  <Select
                    id={modelSelectId}
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    options={modelOptions}
                  />
                </Field>

                <Field label={t('Summary length')} hint={t('Controls the depth and conciseness of the output.')}>
                  <Select
                    id={lengthSelectId}
                    value={summaryLength}
                    onChange={(e) => {
                      const option = lengthOptions.find(({ value }) => value === e.currentTarget.value);
                      if (option) setSummaryLength(option.value);
                    }}
                    options={lengthOptions}
                  />
                </Field>

                {source.pages.length > 3 && (
                  <Field label={t('Page scope')} hint={t('Select how many pages to include in the summary.')}>
                    <Select id={scopeSelectId} value={pageScope} onChange={(e) => setPageScope(e.target.value)} options={scopeOptions} />
                  </Field>
                )}
              </div>

              <div className={styles.noticeBox}>
                🔒 <strong>{t('100% private and in your browser:')}</strong>{' '}
                {t(
                  'The AI model runs directly in your browser via WebAssembly. Model weights are downloaded directly from Hugging Face and cached locally. Your PDF contents never leave your device.',
                )}
              </div>

              <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Reset')}
                </Button>
                <Button variant="primary" onClick={handleSummarize}>
                  {t('Generate summary')}
                </Button>
              </div>
            </div>
          )}

          {running && (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar value={progressRatio} label={translateAiProgressLabel(progressLabel || 'Running summarization...', t)} />
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

          {summary && !running && (
            <div className={styles.outputArea}>
              <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>{t('Document summary')}</h3>
              <p id={summaryNoticeId}>{t('The AI can invent details. Check the summary against the original PDF.')}</p>
              <textarea
                className={styles.outputTextarea}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                aria-label={t('Generated summary')}
                aria-describedby={summaryNoticeId}
              />

              <div className={styles.statsBar}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>{t('Original words')}</span>
                  <span className={styles.statVal}>{originalWords}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>{t('Summary words')}</span>
                  <span className={styles.statVal}>{summaryWords}</span>
                </div>
                {reductionPct > 0 && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('Reduction')}</span>
                    <span className="badge badge-success">{t('{percent}% shorter', { percent: reductionPct })}</span>
                  </div>
                )}
              </div>

              <div className="action-buttons" style={{ marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Start over')}
                </Button>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? t('Copied!') : t('Copy summary')}
                </Button>
                <Button variant="primary" onClick={handleDownload}>
                  {t('Download')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
