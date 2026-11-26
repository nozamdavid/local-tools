import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { createPageNumberDrawer, type PageNumberSettings } from '../_stamp/annotations';
import { getTargetPagesResult } from '../_stamp/pageScope';
import { renderEditedPdfPage, STAMP_PREVIEW_MAX_DIMENSION } from '../_stamp/preview';
import { renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import styles from './Tool.module.css';

type Position = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

export default function PageNumbersTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-page-numbers');
  const source = usePdfSource();
  const { doc, file, loadForEditing } = source;
  const job = useJob();

  const [position, setPosition] = useState<Position>('bottom-center');
  const [format, setFormat] = useState('{n}');
  const [startNumber, setStartNumber] = useState(1);
  const [fontSize, setFontSize] = useState(12);
  const [margin, setMargin] = useState(30);
  const [color, setColor] = useState('#000000');
  const [scope, setScope] = useState<'all' | 'range'>('all');
  const [rangeStr, setRangeStr] = useState('');
  const [excludeFirst, setExcludeFirst] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewPdf = useRef<{ file: File; promise: Promise<PDFDocument> } | null>(null);
  const previewGeneration = useRef(0);
  const positions = [
    { value: 'bottom-center', label: t('Bottom Center') },
    { value: 'bottom-right', label: t('Bottom Right') },
    { value: 'bottom-left', label: t('Bottom Left') },
    { value: 'top-center', label: t('Top Center') },
    { value: 'top-right', label: t('Top Right') },
    { value: 'top-left', label: t('Top Left') },
  ];
  const formats = [
    { value: '{n}', label: t('Number only (1, 2, ...)') },
    { value: 'Page {n}', label: t('Page 1, Page 2, ...') },
    { value: 'Page {n} of {total}', label: t('Page 1 of 10') },
    { value: '{n} / {total}', label: t('1 / 10') },
  ];

  const total = source.pages.length;

  const { pages: targetPages, error: rangeError } = getTargetPagesResult(scope, total, {
    rangeStr,
    excludeFirst,
  });

  const targetSet = new Set(targetPages);
  const targetPageKey = targetPages.join(',');

  const loadForPreview = useCallback(() => {
    if (!file) return loadForEditing();
    if (previewPdf.current?.file === file) return previewPdf.current.promise;

    const entry = { file, promise: loadForEditing() };
    previewPdf.current = entry;
    void entry.promise.catch(() => {
      if (previewPdf.current === entry) previewPdf.current = null;
    });
    return entry.promise;
  }, [file, loadForEditing]);

  useEffect(() => {
    if (!targetPageKey) return;
    const targetNumbers = targetPageKey.split(',').map(Number);
    const firstTargetPage = Number(targetPageKey.split(',')[0]);
    const targets = new Set(targetNumbers);
    setPreviewPage((current) => (targets.has(current) ? current : firstTargetPage));
  }, [targetPageKey]);

  useEffect(() => {
    const generation = ++previewGeneration.current;
    setPreviewUrl(null);
    setPreviewError(false);
    if (!doc || rangeError || job.status === 'running' || job.status === 'done' || previewPage < 1 || previewPage > total) {
      if (job.status === 'done') setPreviewUrl(null);
      setPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    const isStale = () => controller.signal.aborted || generation !== previewGeneration.current;
    setPreviewLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const previewTargets = targetPageKey ? targetPageKey.split(',').map(Number) : [];
        const targetIndex = previewTargets.indexOf(previewPage);
        let url: string;
        if (targetIndex < 0) {
          url = await renderPdfThumbnail(doc, previewPage, STAMP_PREVIEW_MAX_DIMENSION, controller.signal);
        } else {
          const settings: PageNumberSettings = { position, format, fontSize, margin, color };
          url = await renderEditedPdfPage(
            loadForPreview,
            previewPage,
            async (pdf, page) => {
              const drawPageNumber = await createPageNumberDrawer(pdf, settings);
              drawPageNumber(page, startNumber + targetIndex, previewTargets.length);
            },
            isStale,
            controller.signal,
          );
        }
        if (!isStale()) setPreviewUrl(url);
      } catch {
        if (!isStale()) setPreviewError(true);
      } finally {
        if (!isStale()) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    doc,
    loadForPreview,
    job.status,
    previewPage,
    total,
    targetPageKey,
    rangeError,
    position,
    format,
    startNumber,
    fontSize,
    margin,
    color,
  ]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    previewGeneration.current++;
    previewPdf.current = null;
    job.reset();
    setPreviewPage(1);
    setScope('all');
    setRangeStr('');
    setExcludeFirst(false);
    await source.open(files[0]);
  };

  const handleReset = () => {
    previewGeneration.current++;
    previewPdf.current = null;
    source.reset();
    job.reset();
    setPreviewPage(1);
    setScope('all');
    setRangeStr('');
    setExcludeFirst(false);
  };

  const handleApply = () => {
    if (targetPages.length === 0) return;

    previewPdf.current = null;
    previewGeneration.current++;
    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();
      const pages = pdf.getPages();
      const totalDocPages = pages.length;
      const drawPageNumber = await createPageNumberDrawer(pdf, { position, format, fontSize, margin, color });

      setProgress(0.3);

      let countIndex = 0;
      for (let pNum = 1; pNum <= totalDocPages; pNum++) {
        if (!targetSet.has(pNum)) continue;

        const page = pages[pNum - 1];
        const currentNum = startNumber + countIndex;
        countIndex++;
        drawPageNumber(page, currentNum, targetPages.length);
      }

      setProgress(0.8);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-numbered.pdf` : 'numbered.pdf';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Add customizable page numbers to your PDF pages.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}
          {rangeError && (
            <div className="error-banner" role="alert">
              {t(rangeError)}
            </div>
          )}

          {job.result ? (
            <PdfPreview blob={job.result} filename={outName} pageCount={total} onReset={handleReset} />
          ) : (
            <div>
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
                      {t('Pages:')} <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Change PDF')}
                </Button>
              </div>

              {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}

              {source.doc && (
                <>
                  <div className={styles.controls}>
                    <Field label={t('Position')}>
                      <Select value={position} onChange={(e) => setPosition(e.target.value as Position)} options={positions} />
                    </Field>

                    <Field label={t('Format')}>
                      <Select value={format} onChange={(e) => setFormat(e.target.value)} options={formats} />
                    </Field>

                    <Field label={t('Start Number')} hint={t('First page number to display')}>
                      <input
                        type="number"
                        className={styles.textInput}
                        min={1}
                        value={startNumber}
                        onChange={(e) => setStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                    </Field>

                    <Field label={t('Font Size (pt)')}>
                      <input
                        type="number"
                        className={styles.textInput}
                        min={8}
                        max={72}
                        value={fontSize}
                        onChange={(e) => setFontSize(Math.max(6, parseInt(e.target.value) || 12))}
                      />
                    </Field>

                    <Field label={t('Margin from edge (pt)')}>
                      <input
                        type="number"
                        className={styles.textInput}
                        min={10}
                        max={100}
                        value={margin}
                        onChange={(e) => setMargin(Math.min(100, Math.max(5, parseInt(e.target.value) || 30)))}
                      />
                    </Field>

                    <Field label={t('Text Color')}>
                      <input
                        type="color"
                        style={{
                          width: '100%',
                          height: '42px',
                          padding: '2px',
                          borderRadius: '4px',
                          border: '1px solid var(--input-border)',
                          background: 'var(--input-bg)',
                          cursor: 'pointer',
                        }}
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                      />
                    </Field>

                    <Field label={t('Page Scope')}>
                      <div className={styles.scope} role="radiogroup" aria-label={t('Page scope')}>
                        <label>
                          <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                          {t('All pages')}
                        </label>
                        <label>
                          <input type="radio" name="scope" checked={scope === 'range'} onChange={() => setScope('range')} />
                          {t('Page range')}
                        </label>
                      </div>

                      {scope === 'range' && (
                        <input
                          type="text"
                          className={styles.textInput}
                          style={{ marginTop: '0.5rem' }}
                          placeholder={t('e.g. 1-3, 5, 7-9')}
                          value={rangeStr}
                          onChange={(e) => setRangeStr(e.target.value)}
                        />
                      )}

                      <label className={styles.checkboxRow}>
                        <input type="checkbox" checked={excludeFirst} onChange={(e) => setExcludeFirst(e.target.checked)} />
                        {t('Skip first page (cover page)')}
                      </label>
                    </Field>
                  </div>

                  <section className={styles.livePreview} aria-label={t('Live page number preview')}>
                    <div className={styles.previewHeading}>
                      <h2>{t('Live page number preview')}</h2>
                      <div className={styles.pager}>
                        <Button
                          variant="secondary"
                          onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                          disabled={previewPage <= 1}
                          aria-label={t('Previous page')}
                        >
                          ‹
                        </Button>
                        <span>{t('Previewing page {page} of {total}', { page: previewPage, total })}</span>
                        <Button
                          variant="secondary"
                          onClick={() => setPreviewPage((page) => Math.min(total, page + 1))}
                          disabled={previewPage >= total}
                          aria-label={t('Next page')}
                        >
                          ›
                        </Button>
                      </div>
                    </div>

                    <div
                      className={styles.previewPage}
                      style={{
                        aspectRatio: String((source.pages[previewPage - 1]?.width ?? 1) / (source.pages[previewPage - 1]?.height ?? 1)),
                      }}
                      aria-busy={previewLoading}
                    >
                      {previewUrl ? (
                        <img src={previewUrl} alt={t('Page preview')} className={styles.previewPageImage} draggable={false} />
                      ) : previewError ? (
                        <span className={styles.previewMessage} role="alert">
                          {t('Could not render this page number preview. Check the settings and try again.')}
                        </span>
                      ) : (
                        <span className={styles.previewMessage} role="status">
                          {t(previewLoading ? 'Rendering preview…' : 'Preparing page preview…')}
                        </span>
                      )}
                    </div>
                    <p className={styles.previewHint}>
                      {targetSet.has(previewPage)
                        ? t('The preview uses the selected number format, position, font size, color, and start number.')
                        : t('This page is excluded from page numbering.')}
                    </p>
                  </section>

                  <div className={styles.previewGrid}>
                    {source.pages.map((page, index) => {
                      const pNum = index + 1;
                      const isNumbered = targetSet.has(pNum);
                      let targetIndex = -1;
                      if (isNumbered) {
                        targetIndex = targetPages.indexOf(pNum);
                      }
                      const previewNumber = isNumbered ? startNumber + targetIndex : null;

                      return (
                        <div key={index} className={`${styles.pageCard} ${isNumbered ? styles.pageCardNumbered : ''}`}>
                          {isNumbered && <span className={styles.pageBadge}>#{previewNumber}</span>}
                          <PageThumb
                            src={source.thumbs[index]}
                            width={page.width}
                            height={page.height}
                            alt={t('Page {number}', { number: pNum })}
                          />
                          <span className={styles.pageLabel}>{t('Page {number}', { number: pNum })}</span>
                        </div>
                      );
                    })}
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label={t('Adding page numbers…')} />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        {t('Choose different file')}
                      </Button>
                      <Button variant="primary" onClick={handleApply} disabled={targetPages.length === 0}>
                        {t('Add numbers to {count} {unit}', {
                          count: targetPages.length,
                          unit: targetPages.length === 1 ? t('page') : t('pages'),
                        })}
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
