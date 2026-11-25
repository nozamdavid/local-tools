import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { createWatermarkDrawer, type WatermarkSettings } from '../_stamp/annotations';
import { getTargetPagesResult } from '../_stamp/pageScope';
import { renderEditedPdfPage, STAMP_PREVIEW_MAX_DIMENSION } from '../_stamp/preview';
import { renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import styles from './Tool.module.css';

type WatermarkType = 'text' | 'image';
type Scope = 'all' | 'range' | 'selected';

export default function WatermarkTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-watermark');
  const source = usePdfSource();
  const job = useJob();

  const [type, setType] = useState<WatermarkType>('text');

  // Text watermark options
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState('#888888');

  // Image watermark options
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageScale, setImageScale] = useState(50); // percentage of page width

  // Shared watermark options
  const [opacity, setOpacity] = useState(0.3);
  const [rotation, setRotation] = useState(-45);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [scope, setScope] = useState<Scope>('all');
  const [rangeStr, setRangeStr] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewPdf = useRef<{ file: File; promise: Promise<PDFDocument> } | null>(null);
  const previewGeneration = useRef(0);
  const previewPointer = useRef<number | null>(null);

  const total = source.pages.length;

  const { pages: targetPages, error: rangeError } = getTargetPagesResult(scope, total, { rangeStr, selectedPages: selected });

  const targetPageKey = targetPages.join(',');
  const targetSet = new Set(targetPages);
  const canStamp = type === 'text' ? Boolean(text.trim()) : imageFile !== null;

  const loadForPreview = useCallback(() => {
    const file = source.file;
    if (!file) return source.loadForEditing();
    if (previewPdf.current?.file === file) return previewPdf.current.promise;

    const entry = { file, promise: source.loadForEditing() };
    previewPdf.current = entry;
    void entry.promise.catch(() => {
      if (previewPdf.current === entry) previewPdf.current = null;
    });
    return entry.promise;
  }, [source.file, source.loadForEditing]);

  useEffect(() => {
    if (!targetPageKey) return;
    const targetNumbers = targetPageKey.split(',').map(Number);
    const firstTargetPage = Number(targetPageKey.split(',')[0]);
    const targets = new Set(targetNumbers);
    setPreviewPage((current) => (targets.has(current) ? current : firstTargetPage));
  }, [targetPageKey]);

  useEffect(() => {
    const generation = ++previewGeneration.current;
    const isStale = () => generation !== previewGeneration.current;
    setPreviewUrl(null);
    setPreviewError(false);
    if (!source.doc || rangeError || job.status === 'running' || job.status === 'done' || previewPage < 1 || previewPage > total) {
      if (job.status === 'done') setPreviewUrl(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPreviewLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const previewTargets = new Set(targetPageKey ? targetPageKey.split(',').map(Number) : []);
        const pageIsTarget = previewTargets.has(previewPage);
        let url: string;
        if (!pageIsTarget || !canStamp) {
          url = await renderPdfThumbnail(source.doc!, previewPage, STAMP_PREVIEW_MAX_DIMENSION, controller.signal);
        } else {
          const settings: WatermarkSettings =
            type === 'text'
              ? { type, text, fontSize, color: textColor, opacity, rotation, position }
              : { type, file: imageFile!, scale: imageScale, opacity, rotation, position };
          url = await renderEditedPdfPage(
            loadForPreview,
            previewPage,
            async (pdf, page) => {
              const drawWatermark = await createWatermarkDrawer(pdf, settings);
              drawWatermark(page);
            },
            isStale,
            controller.signal,
          );
        }
        if (!cancelled && !isStale()) setPreviewUrl(url);
      } catch {
        if (!cancelled && !isStale()) setPreviewError(true);
      } finally {
        if (!cancelled && !isStale()) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      if (previewGeneration.current === generation) previewGeneration.current++;
      window.clearTimeout(timeout);
    };
  }, [
    source.doc,
    loadForPreview,
    job.status,
    previewPage,
    total,
    targetPageKey,
    rangeError,
    canStamp,
    type,
    text,
    fontSize,
    textColor,
    imageFile,
    imageScale,
    opacity,
    rotation,
    position.x,
    position.y,
  ]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    previewGeneration.current++;
    previewPdf.current = null;
    job.reset();
    setPreviewPage(1);
    setPosition({ x: 0.5, y: 0.5 });
    setScope('all');
    setRangeStr('');
    setSelected(new Set());
    setImageFile(null);
    await source.open(files[0]);
  };

  const handleReset = () => {
    previewGeneration.current++;
    previewPdf.current = null;
    source.reset();
    job.reset();
    setPreviewPage(1);
    setPosition({ x: 0.5, y: 0.5 });
    setScope('all');
    setRangeStr('');
    setSelected(new Set());
    setImageFile(null);
  };

  const handleImageSelect = (file: File) => {
    setImageFile(file);
  };

  const previewPoint = (clientX: number, clientY: number, rect: DOMRect) => ({
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height)),
  });

  const startMovingWatermark = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canStamp || !targetSet.has(previewPage)) return;
    e.preventDefault();
    previewPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPosition(previewPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  };

  const moveWatermark = (e: React.PointerEvent<HTMLDivElement>) => {
    if (previewPointer.current !== e.pointerId) return;
    setPosition(previewPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  };

  const finishMovingWatermark = (e: React.PointerEvent<HTMLDivElement>) => {
    if (previewPointer.current !== e.pointerId) return;
    previewPointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const moveWatermarkWithKeyboard = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else return;
    e.preventDefault();
    setPosition((prev) => ({
      x: Math.min(1, Math.max(0, prev.x + dx)),
      y: Math.min(1, Math.max(0, prev.y + dy)),
    }));
  };

  const togglePage = (pNum: number) => {
    if (scope !== 'selected') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pNum)) next.delete(pNum);
      else next.add(pNum);
      return next;
    });
  };

  const handleApply = () => {
    if (targetPages.length === 0) return;
    if (type === 'image' && !imageFile) return;

    const settings: WatermarkSettings =
      type === 'text'
        ? { type, text, fontSize, color: textColor, opacity, rotation, position }
        : { type, file: imageFile!, scale: imageScale, opacity, rotation, position };

    previewPdf.current = null;
    previewGeneration.current++;
    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();
      const pages = pdf.getPages();
      const totalDocPages = pages.length;
      const drawWatermark = await createWatermarkDrawer(pdf, settings);
      setProgress(0.4);

      for (let pNum = 1; pNum <= totalDocPages; pNum++) {
        if (!targetSet.has(pNum)) continue;
        drawWatermark(pages[pNum - 1]);
      }

      setProgress(0.85);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-watermarked.pdf` : 'watermarked.pdf';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Stamp a customizable text or image watermark over your PDF pages.')}
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
                  <div style={{ marginTop: '1.25rem' }}>
                    <div className={styles.tabGroup}>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${type === 'text' ? styles.tabBtnActive : ''}`}
                        onClick={() => setType('text')}
                      >
                        {t('Text watermark')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${type === 'image' ? styles.tabBtnActive : ''}`}
                        onClick={() => setType('image')}
                      >
                        {t('Image watermark')}
                      </button>
                    </div>

                    <div className={styles.controls}>
                      {type === 'text' ? (
                        <>
                          <Field label={t('Watermark text')}>
                            <input
                              type="text"
                              className={styles.textInput}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              placeholder={t('e.g. CONFIDENTIAL, DRAFT')}
                            />
                          </Field>

                          <Field label={t('Font Size (pt)')}>
                            <Slider value={fontSize} min={12} max={120} step={2} unit="pt" onChange={setFontSize} />
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
                              value={textColor}
                              onChange={(e) => setTextColor(e.target.value)}
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field label={t('Watermark image')}>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleImageSelect(f);
                              }}
                            />
                            {!imageFile ? (
                              <button type="button" className={styles.imageDropArea} onClick={() => fileInputRef.current?.click()}>
                                <span>{t('Click to select an image (PNG / JPG)')}</span>
                              </button>
                            ) : (
                              <div className={styles.imagePreviewWrapper}>
                                <span className={styles.imageFileName} title={imageFile.name}>
                                  {imageFile.name}
                                </span>
                                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                                  {t('Change image')}
                                </Button>
                              </div>
                            )}
                          </Field>

                          <Field label={t('Image scale (% of page width)')}>
                            <Slider value={imageScale} min={10} max={100} step={5} unit="%" onChange={setImageScale} />
                          </Field>
                        </>
                      )}

                      <Field label={t('Opacity')}>
                        <Slider
                          value={Math.round(opacity * 100)}
                          min={5}
                          max={100}
                          step={5}
                          unit="%"
                          onChange={(v) => setOpacity(v / 100)}
                        />
                      </Field>

                      <Field label={t('Rotation')}>
                        <Slider value={rotation} min={-180} max={180} step={5} unit="°" onChange={setRotation} />
                        <div className={styles.quickAngles}>
                          {[-45, 0, 45, 90].map((deg) => (
                            <button key={deg} type="button" className={styles.angleBtn} onClick={() => setRotation(deg)}>
                              {deg}°
                            </button>
                          ))}
                        </div>
                      </Field>

                      <Field label={t('Page scope')}>
                        <div className={styles.scope} role="radiogroup" aria-label={t('Pages to watermark')}>
                          <label>
                            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                            {t('All pages')}
                          </label>
                          <label>
                            <input type="radio" name="scope" checked={scope === 'range'} onChange={() => setScope('range')} />
                            {t('Page range')}
                          </label>
                          <label>
                            <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />
                            {t('Pick pages')}
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
                      </Field>
                    </div>
                  </div>

                  {scope === 'selected' && (
                    <div className={styles.selectRow}>
                      <span className={styles.selectCount}>{t('{selected} of {total} selected', { selected: selected.size, total })}</span>
                      <Button variant="secondary" onClick={() => setSelected(new Set(Array.from({ length: total }, (_, i) => i + 1)))}>
                        {t('Select all')}
                      </Button>
                      <Button variant="secondary" onClick={() => setSelected(new Set())}>
                        {t('Deselect all')}
                      </Button>
                    </div>
                  )}

                  <section className={styles.livePreview} aria-label={t('Live watermark preview')}>
                    <div className={styles.previewHeading}>
                      <h2>{t('Live watermark preview')}</h2>
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
                      className={`${styles.previewPage} ${canStamp && targetSet.has(previewPage) ? styles.previewPageMovable : ''}`}
                      style={{
                        aspectRatio: String((source.pages[previewPage - 1]?.width ?? 1) / (source.pages[previewPage - 1]?.height ?? 1)),
                      }}
                      aria-busy={previewLoading}
                      onPointerDown={startMovingWatermark}
                      onPointerMove={moveWatermark}
                      onPointerUp={finishMovingWatermark}
                      onPointerCancel={finishMovingWatermark}
                    >
                      {previewUrl ? (
                        <img src={previewUrl} alt={t('Page preview')} className={styles.previewPageImage} draggable={false} />
                      ) : previewError ? (
                        <span className={styles.previewMessage} role="alert">
                          {t('Could not render this watermark preview. Check the image and try again.')}
                        </span>
                      ) : (
                        <span className={styles.previewMessage} role="status">
                          {t(previewLoading ? 'Rendering preview…' : 'Preparing page preview…')}
                        </span>
                      )}
                      {canStamp && targetSet.has(previewPage) && (
                        <button
                          type="button"
                          className={styles.positionHandle}
                          style={{ left: `${position.x * 100}%`, top: `${(1 - position.y) * 100}%` }}
                          aria-label={t('Move watermark to horizontal {x}%, vertical {y}%', {
                            x: Math.round(position.x * 100),
                            y: Math.round(position.y * 100),
                          })}
                          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
                          onKeyDown={moveWatermarkWithKeyboard}
                        >
                          <span className={styles.positionHandleMark} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <p className={styles.previewHint}>
                      {!canStamp
                        ? t(
                            type === 'image'
                              ? 'Choose an image to preview the watermark.'
                              : 'Enter watermark text to preview the watermark.',
                          )
                        : targetSet.has(previewPage)
                          ? t(
                              'Drag anywhere on the page to move the watermark. Focus the position marker and use arrow keys to move it precisely.',
                            )
                          : t('No watermark will be added to this page.')}
                    </p>
                  </section>

                  <div className={styles.pageGrid}>
                    {source.pages.map((page, index) => {
                      const pNum = index + 1;
                      const isTarget = targetSet.has(pNum);
                      const clickable = scope === 'selected';

                      return (
                        <div
                          key={index}
                          className={`${styles.pageCard} ${isTarget && clickable ? styles.pageCardSelected : ''} ${clickable ? styles.pageCardClickable : ''}`}
                          onClick={() => togglePage(pNum)}
                        >
                          {clickable && (
                            <input
                              type="checkbox"
                              className={styles.pageCheckbox}
                              checked={isTarget}
                              aria-label={t('Select page {number}', { number: pNum })}
                              onChange={() => togglePage(pNum)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
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
                    <ProgressBar value={job.progress} label={t('Applying watermark…')} />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        {t('Choose different file')}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleApply}
                        disabled={targetPages.length === 0 || (type === 'image' && !imageFile) || (type === 'text' && !text.trim())}
                      >
                        {t('Apply watermark to {count} {unit}', {
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
