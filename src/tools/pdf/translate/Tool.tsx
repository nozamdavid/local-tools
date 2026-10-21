import { useState, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { extractPdfText, chunkTextForInference, TRANSLATION_PAIRS, AiJob, type ExtractionResult } from '../_ai';
import styles from './Tool.module.css';

export default function TranslateTool() {
  const meta = getToolMeta('pdf-translate');
  const source = usePdfSource();

  const pairSelectId = useId();
  const scopeSelectId = useId();

  const [selectedPairId, setSelectedPairId] = useState<string>(TRANSLATION_PAIRS[0].id);
  const [pageScope, setPageScope] = useState<string>('all');

  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);

  const [running, setRunning] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [translation, setTranslation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeJob = useRef<AiJob | null>(null);

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
    setExtracting(false);
    setExtractionResult(null);
    setRunning(false);
    setProgressRatio(0);
    setProgressLabel('');
    setTranslation(null);
    setError(null);
    setCopied(false);
  };

  const handleLoadDoc = async () => {
    if (!source.doc) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await extractPdfText(source.doc);
      setExtractionResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to extract text from PDF.');
    } finally {
      setExtracting(false);
    }
  };

  if (source.doc && !extractionResult && !extracting && !source.loading) {
    handleLoadDoc();
  }

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
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
    label: `${p.label} (${p.sizeEstimate})`,
  }));

  const scopeOptions = [
    { value: 'all', label: `All pages (${source.pages.length} pages)` },
    { value: '3', label: 'First 3 pages' },
    { value: '5', label: 'First 5 pages' },
    { value: '10', label: 'First 10 pages' },
  ];

  const originalWords = extractionResult?.totalWords ?? 0;
  const translatedWords = translation ? translation.split(/\s+/).filter(Boolean).length : 0;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Translates PDF text locally on your device with on-device AI. Outputs plain translated text."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {error && <div className="error-banner">{error}</div>}

          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                File: <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                Size: <strong>{formatBytes(file.size)}</strong>
              </span>
              {source.pages.length > 0 && (
                <span className="meta-chip">
                  Pages: <strong>{source.pages.length}</strong>
                </span>
              )}
              {extractionResult && (
                <span className="meta-chip">
                  Words: <strong>{extractionResult.totalWords}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleReset} disabled={running}>
              Change PDF
            </Button>
          </div>

          {(source.loading || extracting) && (
            <p className="status-text">{source.loading ? 'Opening PDF document...' : 'Extracting document text...'}</p>
          )}

          {extractionResult && !extractionResult.hasText && !extracting && (
            <div className={styles.ocrNotice}>
              <div className={styles.ocrNoticeTitle}>No Selectable Text Found</div>
              <p className={styles.ocrNoticeDesc}>
                This PDF appears to be a scanned document or contains only images with no embedded text layer. Local translation requires
                machine-readable text. Please process this PDF with the OCR PDF tool first to recognize and extract its text.
              </p>
              <div className="action-buttons" style={{ justifyContent: 'center' }}>
                <a href="/pdf/ocr" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                  Go to OCR PDF
                </a>
              </div>
            </div>
          )}

          {extractionResult && extractionResult.hasText && !translation && !running && (
            <div>
              <div className={styles.controls}>
                <Field label="Language pair" hint={`Model: ${currentPair.modelId} (${currentPair.sizeEstimate})`}>
                  <Select
                    id={pairSelectId}
                    value={selectedPairId}
                    onChange={(e) => setSelectedPairId(e.target.value)}
                    options={pairOptions}
                  />
                </Field>

                {source.pages.length > 3 && (
                  <Field label="Page scope" hint="Select how many pages to include in the translation.">
                    <Select id={scopeSelectId} value={pageScope} onChange={(e) => setPageScope(e.target.value)} options={scopeOptions} />
                  </Field>
                )}
              </div>

              <div className={styles.noticeBox}>
                🔒 <strong>100% Private & In-Browser:</strong> Translation models execute entirely on your device using WebAssembly. Model
                weights are downloaded directly from Hugging Face and cached in your browser. No document text or metadata is ever
                transmitted over the network.
                <br />
                <small style={{ marginTop: '0.4rem', display: 'block' }}>
                  Note: Output is formatted plain text with page and paragraph demarcations preserved.
                </small>
              </div>

              <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Reset
                </Button>
                <Button variant="primary" onClick={handleTranslate}>
                  Translate Document
                </Button>
              </div>
            </div>
          )}

          {running && (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar value={progressRatio} label={progressLabel || 'Translating document...'} />
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
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {translation && !running && (
            <div className={styles.outputArea}>
              <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Translated Text</h3>
              <textarea
                className={styles.outputTextarea}
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                aria-label="Translated output"
              />

              <div className={styles.statsBar}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Original Words</span>
                  <span className={styles.statVal}>{originalWords}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Translated Words</span>
                  <span className={styles.statVal}>{translatedWords}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Target Language</span>
                  <span className={styles.statVal} style={{ textTransform: 'uppercase' }}>
                    {currentPair.targetLang}
                  </span>
                </div>
              </div>

              <div className="action-buttons" style={{ marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Start Over
                </Button>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy Translated Text'}
                </Button>
                <Button variant="primary" onClick={handleDownload}>
                  Download Text (.txt)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
