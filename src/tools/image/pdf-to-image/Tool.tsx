import { useState, useEffect, useRef, useId } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { loadPdfDocument, renderPdfThumbnail, renderPdfPageToBlob } from '../_pdf/pdfRenderer';
import { PasswordDialog } from '../_pdf/PasswordDialog';
import styles from './Tool.module.css';

type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export default function PdfToImageTool({ toolId = 'img-pdf-to-image' }: { toolId?: string }) {
  const { t } = useI18n();
  const meta = getToolMeta(toolId);
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [dpi, setDpi] = useState<number>(150);
  const [items, setItems] = useState<BatchResultItem[] | null>(null);

  const [passwordState, setPasswordState] = useState<{
    isOpen: boolean;
    reason: number;
    verify?: (password: string) => void;
  } | null>(null);

  const [docLoading, setDocLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const job = useJob();
  const formatId = useId();
  const dpiId = useId();
  const documentLoad = useRef<AbortController | null>(null);

  useEffect(() => () => documentLoad.current?.abort(), []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    documentLoad.current?.abort();
    const controller = new AbortController();
    documentLoad.current = controller;
    setFile(selected);
    setPdfDoc(null);
    setThumbnails({});
    setSelectedPages(new Set());
    setItems(null);
    setLoadError(null);
    setPasswordState(null);
    setDocLoading(true);
    job.reset();

    try {
      const doc = await loadPdfDocument(selected, {
        signal: controller.signal,
        onPassword: (verify, reason) => {
          setPasswordState({ isOpen: true, reason, verify });
        },
      });

      if (!controller.signal.aborted) {
        setPdfDoc(doc);
        setPasswordState(null);
        const count = doc.numPages;
        setSelectedPages(new Set(Array.from({ length: count }, (_, i) => i + 1)));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load PDF document.');
        setPasswordState(null);
      }
    } finally {
      if (!controller.signal.aborted) setDocLoading(false);
    }
  };

  // Generate thumbnails sequentially when doc loads
  useEffect(() => {
    if (!pdfDoc || !file) return;
    let isCancelled = false;

    async function generateThumbs() {
      if (!pdfDoc) return;
      const count = pdfDoc.numPages;
      for (let p = 1; p <= count; p++) {
        if (isCancelled) break;
        try {
          const thumbUrl = await renderPdfThumbnail(pdfDoc, p, 160);
          if (isCancelled) break;
          setThumbnails((prev) => ({ ...prev, [p]: thumbUrl }));
        } catch {
          // ignore thumb error
        }
      }
    }

    generateThumbs();
    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, file]);

  const handleReset = () => {
    documentLoad.current?.abort();
    documentLoad.current = null;
    setFile(null);
    setPdfDoc(null);
    setThumbnails({});
    setSelectedPages(new Set());
    setItems(null);
    setLoadError(null);
    setPasswordState(null);
    setDocLoading(false);
    job.reset();
  };

  const togglePage = (pageNum: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!pdfDoc) return;
    setSelectedPages(new Set(Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1)));
  };

  const deselectAll = () => {
    setSelectedPages(new Set());
  };

  const handleConvert = () => {
    if (!pdfDoc || !file || selectedPages.size === 0) return;

    const pagesToRender = Array.from(selectedPages).sort((a, b) => a - b);
    const cleanBase = file.name.replace(/\.pdf$/i, '');
    const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
    const scale = dpi / 72;

    job.run(async (setProgress) => {
      const outputItems: BatchResultItem[] = [];

      for (let i = 0; i < pagesToRender.length; i++) {
        setProgress(i / pagesToRender.length);
        const pageNum = pagesToRender[i];
        const blob = await renderPdfPageToBlob(pdfDoc, pageNum, scale, format, 0.92);
        outputItems.push({
          name: `${cleanBase}-page-${pageNum}.${ext}`,
          blob,
        });
      }

      setProgress(1);
      setItems(outputItems);
      return outputItems[0].blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {passwordState?.isOpen && passwordState.verify && (
        <PasswordDialog
          reason={passwordState.reason}
          onSubmit={(pw) => {
            passwordState.verify!(pw);
          }}
          onCancel={handleReset}
        />
      )}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Supports multi-page and password-protected PDFs.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {loadError && <div className="error-banner">{t(loadError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {items && items.length > 0 ? (
            items.length === 1 ? (
              <ResultPanel blob={items[0].blob} filename={items[0].name} kind="image" onReset={handleReset} />
            ) : (
              <BatchResults items={items} onReset={handleReset} />
            )
          ) : (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div className="meta-chips">
                  <span className="meta-chip">
                    {t('File')}: <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {pdfDoc && (
                    <span className="meta-chip">
                      {t('Pages')}: <strong>{pdfDoc.numPages}</strong>
                    </span>
                  )}
                  {pdfDoc && (
                    <span className="meta-chip">
                      {t('Selected')}:{' '}
                      <strong>{t('{selected} of {total}', { selected: selectedPages.size, total: pdfDoc.numPages })}</strong>
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button variant="secondary" onClick={selectAll}>
                    {t('Select all')}
                  </Button>
                  <Button variant="secondary" onClick={deselectAll}>
                    {t('Deselect all')}
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Change PDF')}
                  </Button>
                </div>
              </div>

              {docLoading ? (
                <div style={{ margin: '2rem 0', textAlign: 'center' }}>
                  <p>{t('Opening PDF document...')}</p>
                </div>
              ) : pdfDoc ? (
                <div className={styles.pageGrid}>
                  {Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1).map((pageNum) => {
                    const isSelected = selectedPages.has(pageNum);
                    const thumb = thumbnails[pageNum];

                    return (
                      <div
                        key={pageNum}
                        className={`${styles.pageCard} ${isSelected ? styles.pageCardSelected : ''}`}
                        onClick={() => togglePage(pageNum)}
                      >
                        <input
                          type="checkbox"
                          className={styles.pageCheckbox}
                          checked={isSelected}
                          onChange={() => {}} // handled by card onClick
                        />
                        <div className={styles.pageThumbWrapper}>
                          {thumb ? (
                            <img src={thumb} alt={t('Page {number}', { number: pageNum })} className={styles.pageThumb} />
                          ) : (
                            <div className={styles.pageThumbPlaceholder}>{t('Loading…')}</div>
                          )}
                        </div>
                        <span className={styles.pageLabel}>{t('Page {number}', { number: pageNum })}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Converting PDF pages to images...')} />
              ) : (
                pdfDoc && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <Field label={t('Output image format')} hint={t('JPG is compact; PNG preserves crisp graphics; WebP offers both.')}>
                      <Select
                        id={formatId}
                        value={format}
                        onChange={(e) => setFormat(e.target.value as ImageFormat)}
                        options={[
                          { value: 'image/jpeg', label: t('JPG (standard photo format)') },
                          { value: 'image/png', label: t('PNG (lossless / crisp text)') },
                          { value: 'image/webp', label: t('WEBP (modern high efficiency)') },
                        ]}
                      />
                    </Field>

                    <Field label={t('Resolution / DPI')} hint={t('Higher DPI yields sharper images with larger file sizes.')}>
                      <Select
                        id={dpiId}
                        value={String(dpi)}
                        onChange={(e) => setDpi(Number(e.target.value))}
                        options={[
                          { value: '72', label: t('72 DPI (Standard screen resolution)') },
                          { value: '150', label: t('150 DPI (Medium / Crisp - recommended)') },
                          { value: '300', label: t('300 DPI (High resolution / Print quality)') },
                        ]}
                      />
                    </Field>

                    <div className="action-buttons" style={{ marginTop: '2rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        {t('Choose different file')}
                      </Button>
                      <Button variant="primary" onClick={handleConvert} disabled={selectedPages.size === 0}>
                        {selectedPages.size === 1 ? t('Convert one page') : t('Convert {count} pages', { count: selectedPages.size })}
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
