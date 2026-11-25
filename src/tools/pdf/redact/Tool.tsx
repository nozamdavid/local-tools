import React, { useRef, useState } from 'react';
import { Button, Field, Select } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ToolPage } from '../../../components/ToolPage';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { getToolMeta } from '../../registry';
import { redactPdf } from '../_edit/redact';
import type { RedactionBox } from '../_edit/types';
import { usePdfSource } from '../_thumbs/usePdfSource';
import styles from './Tool.module.css';

export default function RedactTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-redact');
  const source = usePdfSource();
  const job = useJob();

  const [previewPage, setPreviewPage] = useState<number>(1);
  const [redactions, setRedactions] = useState<RedactionBox[]>([]);
  const [boxColor, setBoxColor] = useState<string>('#000000');
  const [dpi, setDpi] = useState<number>(150);

  // Rectangle dragging state
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const total = source.pages.length;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setRedactions([]);
    setPreviewPage(1);
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
    setRedactions([]);
    setPreviewPage(1);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    overlayRef.current.setPointerCapture(e.pointerId);
    setIsSelecting(true);
    setDragStart({ x, y });
    setDragCurrent({ x, y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSelecting || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));

    setDragCurrent({ x, y });
  };

  const handlePointerUp = () => {
    if (!isSelecting || !dragStart || !dragCurrent) {
      setIsSelecting(false);
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const xMin = Math.min(dragStart.x, dragCurrent.x);
    const xMax = Math.max(dragStart.x, dragCurrent.x);
    const yMin = Math.min(dragStart.y, dragCurrent.y);
    const yMax = Math.max(dragStart.y, dragCurrent.y);

    const widthPercent = xMax - xMin;
    const heightPercent = yMax - yMin;

    // Only add if rectangle has a noticeable area (> 1%)
    if (widthPercent > 1 && heightPercent > 1) {
      const newBox: RedactionBox = {
        id: `redact-${Date.now()}-${Math.random()}`,
        pageNum: previewPage,
        xPercent: Math.round(xMin * 100) / 100,
        yTopPercent: Math.round(yMin * 100) / 100,
        widthPercent: Math.round(widthPercent * 100) / 100,
        heightPercent: Math.round(heightPercent * 100) / 100,
        color: boxColor,
      };

      setRedactions((prev) => [...prev, newBox]);
    }

    setIsSelecting(false);
    setDragStart(null);
    setDragCurrent(null);
  };

  const removeBox = (id: string) => {
    setRedactions((prev) => prev.filter((b) => b.id !== id));
  };

  const clearPageBoxes = () => {
    setRedactions((prev) => prev.filter((b) => b.pageNum !== previewPage));
  };

  const handleRedact = () => {
    if (!source.doc) return;

    job.run(async (setProgress) => {
      setProgress(0.05);
      const outBytes = await redactPdf(source.doc!, redactions, {
        dpi,
        quality: 0.92,
        onProgress: (ratio) => setProgress(0.05 + ratio * 0.9),
      });

      setProgress(1);
      return new Blob([outBytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-redacted.pdf` : 'redacted.pdf';
  const previewThumb = source.thumbs[previewPage - 1];
  const currentPageBoxes = redactions.filter((b) => b.pageNum === previewPage);

  // Live drag rect calculations
  const dragRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x),
          top: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Permanently black out sensitive areas and sanitize metadata. 100% in-browser.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

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

              {/* Prominent Permanent Redaction & Rasterization Disclosure */}
              <div className={styles.warningBanner}>
                <strong>{t('⚠️ Permanent Redaction & Rasterization Disclosure:')}</strong>{' '}
                {t(
                  'Redaction permanently removes underlying sensitive data by rasterizing pages into high-resolution images, burning opaque rectangles directly into the pixel data, and generating an entirely new PDF with zero source objects, metadata, or attachments. Because pages are rasterized to ensure unrecoverable deletion, selectable text on those pages will be converted to page imagery.',
                )}
              </div>

              {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}

              {source.doc && (
                <div className={styles.editorGrid}>
                  {/* Left Column: Visual Page Preview & Redaction Selection Overlay */}
                  <div className={styles.previewColumn}>
                    <div className={styles.pageNav}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        {t('Page {page} of {total} ({count} redactions)', { page: previewPage, total, count: currentPageBoxes.length })}
                      </span>
                      <div className={styles.pageNavButtons}>
                        <Button variant="secondary" disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}>
                          {t('Prev')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={previewPage >= total}
                          onClick={() => setPreviewPage((p) => Math.min(total, p + 1))}
                        >
                          {t('Next')}
                        </Button>
                      </div>
                    </div>

                    <div className={styles.previewContainer}>
                      {previewThumb ? (
                        <div className={styles.pageImgWrapper}>
                          <img src={previewThumb} alt={t('Page {number}', { number: previewPage })} className={styles.pageImg} />

                          {/* Interactive selection overlay for drawing redactions */}
                          <div
                            ref={overlayRef}
                            className={styles.selectionOverlay}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                          >
                            {/* Render existing redaction boxes on this page */}
                            {currentPageBoxes.map((box) => (
                              <div
                                key={box.id}
                                className={styles.redactionBox}
                                style={{
                                  left: `${box.xPercent}%`,
                                  top: `${box.yTopPercent}%`,
                                  width: `${box.widthPercent}%`,
                                  height: `${box.heightPercent}%`,
                                  backgroundColor: box.color,
                                }}
                              >
                                <button
                                  className={styles.deleteBoxBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeBox(box.id);
                                  }}
                                  title={t('Remove redaction')}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}

                            {/* Render live drag rectangle while selecting */}
                            {isSelecting && dragRect && (
                              <div
                                className={styles.dragSelectionBox}
                                style={{
                                  left: `${dragRect.left}%`,
                                  top: `${dragRect.top}%`,
                                  width: `${dragRect.width}%`,
                                  height: `${dragRect.height}%`,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>{t('Loading page preview…')}</div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Controls */}
                  <div className={styles.controlsColumn}>
                    <div className={styles.card}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{t('Redaction Tools')}</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                        {t('Click and drag across sensitive text or images on the page preview to mark an opaque redaction area.')}
                      </p>

                      <Field label={t('Redaction Fill Color')}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="boxColor"
                              value="#000000"
                              checked={boxColor === '#000000'}
                              onChange={() => setBoxColor('#000000')}
                            />
                            <span>{t('Solid Black')}</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="boxColor"
                              value="#ffffff"
                              checked={boxColor === '#ffffff'}
                              onChange={() => setBoxColor('#ffffff')}
                            />
                            <span>{t('Solid White')}</span>
                          </label>
                        </div>
                      </Field>

                      <Field
                        label={t('Rasterization Quality / DPI')}
                        hint={t('Higher DPI produces sharper text but takes longer to process.')}
                      >
                        <Select
                          options={[
                            { value: '150', label: t('150 DPI (Balanced / Recommended)') },
                            { value: '200', label: t('200 DPI (High Resolution)') },
                          ]}
                          value={String(dpi)}
                          onChange={(e) => setDpi(Number(e.target.value))}
                        />
                      </Field>

                      {currentPageBoxes.length > 0 && (
                        <Button variant="secondary" onClick={clearPageBoxes}>
                          {t('Clear Page {page} Redactions', { page: previewPage })}
                        </Button>
                      )}
                    </div>

                    <div className={styles.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                          {t('Marked Redactions ({count})', { count: redactions.length })}
                        </span>
                        {redactions.length > 0 && (
                          <Button
                            variant="secondary"
                            onClick={() => setRedactions([])}
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                          >
                            {t('Clear All')}
                          </Button>
                        )}
                      </div>

                      {redactions.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                          {t('No redactions marked. Drag across the preview to create one.')}
                        </p>
                      ) : (
                        <div className={styles.boxList}>
                          {redactions.map((box, idx) => (
                            <div key={box.id} className={styles.boxListItem}>
                              <span>
                                <strong>#{idx + 1}</strong>{' '}
                                {t('Page {page} — {width}% × {height}%', {
                                  page: box.pageNum,
                                  width: Math.round(box.widthPercent),
                                  height: Math.round(box.heightPercent),
                                })}
                              </span>
                              <button className={styles.deleteListBtn} onClick={() => removeBox(box.id)} title={t('Remove')}>
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {job.status === 'running' ? (
                      <ProgressBar value={job.progress} label={t('Redacting and rasterizing PDF...')} />
                    ) : (
                      <Button variant="primary" disabled={redactions.length === 0} onClick={handleRedact}>
                        {t('Permanently Redact PDF ({count} marked)', { count: redactions.length })}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
