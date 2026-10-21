import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Slider } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ToolPage } from '../../../components/ToolPage';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { getToolMeta } from '../../registry';
import { applyAnnotations } from '../_edit/annotate';
import type { Annotation, AnnotationType } from '../_edit/types';
import { usePdfSource } from '../_thumbs/usePdfSource';
import styles from './Tool.module.css';

export default function EditTool() {
  const meta = getToolMeta('pdf-edit');
  const source = usePdfSource();
  const job = useJob();

  const [previewPage, setPreviewPage] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<AnnotationType>('text');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pageScope, setPageScope] = useState<'current' | 'all'>('current');

  // Text state
  const [textContent, setTextContent] = useState('Sample Text');
  const [textSize, setTextSize] = useState(16);
  const [textColor, setTextColor] = useState('#000000');
  const [hasBgColor, setHasBgColor] = useState(false);
  const [textBgColor, setTextBgColor] = useState('#ffff99');
  const [textX, setTextX] = useState(20);
  const [textY, setTextY] = useState(70); // from visual bottom

  // Image state
  const [uploadedImgUrl, setUploadedImgUrl] = useState<string | null>(null);
  const [imgAspect, setImgAspect] = useState(1);
  const [imgWidth, setImgWidth] = useState(25);
  const [imgX, setImgX] = useState(20);
  const [imgY, setImgY] = useState(50);

  // Rect state
  const [rectWidth, setRectWidth] = useState(30);
  const [rectHeight, setRectHeight] = useState(15);
  const [rectFill, setRectFill] = useState('#e0e0e0');
  const [hasFill, setHasFill] = useState(false);
  const [rectStroke, setRectStroke] = useState('#ff0000');
  const [rectStrokeWidth, setRectStrokeWidth] = useState(2);
  const [rectX, setRectX] = useState(20);
  const [rectY, setRectY] = useState(40);

  // Freehand draw state
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#ff0000');
  const [penWidth, setPenWidth] = useState(3);
  const [hasDrawnStrokes, setHasDrawnStrokes] = useState(false);

  const total = source.pages.length;

  useEffect(() => {
    if (total > 0 && previewPage > total) {
      setPreviewPage(1);
    }
  }, [total, previewPage]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setAnnotations([]);
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
    setAnnotations([]);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setUploadedImgUrl(url);
      const img = new Image();
      img.onload = () => {
        setImgAspect(img.naturalHeight / img.naturalWidth);
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  // Canvas drawing handlers
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    setHasDrawnStrokes(true);

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearDrawing = () => {
    const canvas = drawCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawnStrokes(false);
  };

  const addTextAnnotation = () => {
    if (!textContent.trim()) return;
    const targetPages = pageScope === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : [previewPage];

    const newItems: Annotation[] = targetPages.map((p) => ({
      id: `text-${Date.now()}-${Math.random()}`,
      type: 'text',
      pageNum: p,
      text: textContent,
      fontSize: textSize,
      color: textColor,
      backgroundColor: hasBgColor ? textBgColor : undefined,
      xPercent: textX,
      yPercent: textY,
      widthPercent: Math.min(60, textContent.length * 1.5),
      heightPercent: 4,
    }));

    setAnnotations((prev) => [...prev, ...newItems]);
  };

  const addImageAnnotation = () => {
    if (!uploadedImgUrl) return;
    const targetPages = pageScope === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : [previewPage];

    const hPercent = imgWidth * imgAspect;
    const newItems: Annotation[] = targetPages.map((p) => ({
      id: `img-${Date.now()}-${Math.random()}`,
      type: 'image',
      pageNum: p,
      dataUrl: uploadedImgUrl,
      xPercent: imgX,
      yPercent: imgY,
      widthPercent: imgWidth,
      heightPercent: hPercent,
    }));

    setAnnotations((prev) => [...prev, ...newItems]);
  };

  const addRectAnnotation = () => {
    const targetPages = pageScope === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : [previewPage];

    const newItems: Annotation[] = targetPages.map((p) => ({
      id: `rect-${Date.now()}-${Math.random()}`,
      type: 'rect',
      pageNum: p,
      fillColor: hasFill ? rectFill : undefined,
      strokeColor: rectStroke,
      strokeWidth: rectStrokeWidth,
      xPercent: rectX,
      yPercent: rectY,
      widthPercent: rectWidth,
      heightPercent: rectHeight,
    }));

    setAnnotations((prev) => [...prev, ...newItems]);
  };

  const addDrawingAnnotation = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas || !hasDrawnStrokes) return;
    const dataUrl = canvas.toDataURL('image/png');

    const item: Annotation = {
      id: `draw-${Date.now()}-${Math.random()}`,
      type: 'drawing',
      pageNum: previewPage,
      dataUrl,
      xPercent: 0,
      yPercent: 0,
      widthPercent: 100,
      heightPercent: 100,
    };

    setAnnotations((prev) => [...prev, item]);
    clearDrawing();
  };

  const removeAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  };

  const handleApply = () => {
    if (annotations.length === 0) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();
      setProgress(0.35);

      await applyAnnotations(pdf, annotations);
      setProgress(0.8);

      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-edited.pdf` : 'edited.pdf';
  const previewThumb = source.thumbs[previewPage - 1];
  const currentPageAnns = annotations.filter((a) => a.pageNum === previewPage);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Add text, images, rectangles and freehand drawings to your PDF pages. 100% in-browser."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <PdfPreview blob={job.result} filename={outName} pageCount={total} onReset={handleReset} />
          ) : (
            <div>
              <div className={styles.topRow}>
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    Size: <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {source.doc && (
                    <span className="meta-chip">
                      Pages: <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset}>
                  Change PDF
                </Button>
              </div>

              <div className={styles.noticeBanner}>
                <strong>Annotations overlay only:</strong> This tool places visual annotations (text, uploaded images, shapes, and freehand
                marks) over selected PDF pages. It does not modify or reflow the original underlying PDF text.
              </div>

              {source.loading && <p className={styles.status}>Opening PDF document…</p>}

              {source.doc && (
                <div className={styles.editorGrid}>
                  {/* Left Column: Visual Page Preview & Drawing Canvas */}
                  <div className={styles.previewColumn}>
                    <div className={styles.pageNav}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        Page {previewPage} of {total}
                      </span>
                      <div className={styles.pageNavButtons}>
                        <Button variant="secondary" disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}>
                          Prev
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={previewPage >= total}
                          onClick={() => setPreviewPage((p) => Math.min(total, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>

                    <div className={styles.previewContainer}>
                      {previewThumb ? (
                        <div className={styles.pageImgWrapper}>
                          <img src={previewThumb} alt={`Page ${previewPage} preview`} className={styles.pageImg} />

                          {/* Render current page's annotations overlay */}
                          <div className={styles.overlayLayer}>
                            {currentPageAnns.map((ann) => {
                              const bottomPercent = ann.yPercent;
                              const leftPercent = ann.xPercent;

                              if (ann.type === 'text') {
                                return (
                                  <div
                                    key={ann.id}
                                    className={styles.annotationItem}
                                    style={{
                                      bottom: `${bottomPercent}%`,
                                      left: `${leftPercent}%`,
                                      fontSize: `${Math.max(10, ann.fontSize * 0.75)}px`,
                                      color: ann.color,
                                      backgroundColor: ann.backgroundColor || 'transparent',
                                      padding: '2px 4px',
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    {ann.text}
                                  </div>
                                );
                              }

                              if (ann.type === 'rect') {
                                return (
                                  <div
                                    key={ann.id}
                                    className={styles.annotationItem}
                                    style={{
                                      bottom: `${bottomPercent}%`,
                                      left: `${leftPercent}%`,
                                      width: `${ann.widthPercent}%`,
                                      height: `${ann.heightPercent}%`,
                                      backgroundColor: ann.fillColor || 'transparent',
                                      borderColor: ann.strokeColor,
                                      borderWidth: `${ann.strokeWidth}px`,
                                      borderStyle: 'solid',
                                    }}
                                  />
                                );
                              }

                              if (ann.type === 'image' || ann.type === 'drawing') {
                                return (
                                  <img
                                    key={ann.id}
                                    src={ann.dataUrl}
                                    alt="annotation"
                                    className={styles.annotationItem}
                                    style={{
                                      bottom: `${bottomPercent}%`,
                                      left: `${leftPercent}%`,
                                      width: `${ann.widthPercent}%`,
                                      height: ann.type === 'drawing' ? '100%' : `${ann.heightPercent}%`,
                                      objectFit: 'contain',
                                      border: 'none',
                                    }}
                                  />
                                );
                              }

                              return null;
                            })}

                            {/* Freehand drawing canvas over page when in draw mode */}
                            {activeTab === 'drawing' && (
                              <canvas
                                ref={drawCanvasRef}
                                width={600}
                                height={800}
                                role="img"
                                aria-label="Freehand drawing area over the page. Drawing needs a mouse, touch or pen."
                                className={styles.drawingCanvas}
                                onPointerDown={startDrawing}
                                onPointerMove={draw}
                                onPointerUp={stopDrawing}
                                onPointerCancel={stopDrawing}
                              />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>Loading page preview…</div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Controls */}
                  <div className={styles.controlsColumn}>
                    <div className={styles.tabGroup}>
                      <button
                        className={`${styles.tabBtn} ${activeTab === 'text' ? styles.tabBtnActive : ''}`}
                        onClick={() => setActiveTab('text')}
                      >
                        ✍️ Text
                      </button>
                      <button
                        className={`${styles.tabBtn} ${activeTab === 'image' ? styles.tabBtnActive : ''}`}
                        onClick={() => setActiveTab('image')}
                      >
                        🖼️ Image
                      </button>
                      <button
                        className={`${styles.tabBtn} ${activeTab === 'rect' ? styles.tabBtnActive : ''}`}
                        onClick={() => setActiveTab('rect')}
                      >
                        ⬜ Rectangle
                      </button>
                      <button
                        className={`${styles.tabBtn} ${activeTab === 'drawing' ? styles.tabBtnActive : ''}`}
                        onClick={() => setActiveTab('drawing')}
                      >
                        ✏️ Draw
                      </button>
                    </div>

                    <Field label="Apply to">
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <label>
                          <input type="radio" name="pageScope" checked={pageScope === 'current'} onChange={() => setPageScope('current')} />{' '}
                          Current page ({previewPage})
                        </label>
                        <label>
                          <input type="radio" name="pageScope" checked={pageScope === 'all'} onChange={() => setPageScope('all')} /> All
                          pages ({total})
                        </label>
                      </div>
                    </Field>

                    {/* Tab: Text */}
                    {activeTab === 'text' && (
                      <div className={styles.card}>
                        <Field label="Annotation Text">
                          <input
                            type="text"
                            className={styles.input}
                            value={textContent}
                            onChange={(e) => setTextContent(e.target.value)}
                            placeholder="Enter text..."
                          />
                        </Field>

                        <Field label="Font Size">
                          <Slider value={textSize} min={8} max={64} step={1} unit="pt" onChange={setTextSize} />
                        </Field>

                        <div className={styles.colorPickerRow}>
                          <Field label="Text Color">
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={textColor}
                              onChange={(e) => setTextColor(e.target.value)}
                            />
                          </Field>

                          <Field label="Background Highlight">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" checked={hasBgColor} onChange={(e) => setHasBgColor(e.target.checked)} />
                              {hasBgColor && (
                                <input
                                  type="color"
                                  className={styles.colorInput}
                                  value={textBgColor}
                                  onChange={(e) => setTextBgColor(e.target.value)}
                                />
                              )}
                            </div>
                          </Field>
                        </div>

                        <Field label="Horizontal Position (X %)">
                          <Slider value={textX} min={0} max={90} step={1} unit="%" onChange={setTextX} />
                        </Field>

                        <Field label="Vertical Position (Y % from bottom)">
                          <Slider value={textY} min={5} max={95} step={1} unit="%" onChange={setTextY} />
                        </Field>

                        <Button onClick={addTextAnnotation}>Add Text Annotation</Button>
                      </div>
                    )}

                    {/* Tab: Image */}
                    {activeTab === 'image' && (
                      <div className={styles.card}>
                        <Field label="Choose Image (PNG, JPG, WebP)">
                          <input type="file" accept="image/*" onChange={handleImageUpload} className={styles.input} />
                        </Field>

                        {uploadedImgUrl && (
                          <>
                            <Field label="Width (%)">
                              <Slider value={imgWidth} min={5} max={80} step={1} unit="%" onChange={setImgWidth} />
                            </Field>

                            <Field label="Horizontal Position (X %)">
                              <Slider value={imgX} min={0} max={90} step={1} unit="%" onChange={setImgX} />
                            </Field>

                            <Field label="Vertical Position (Y % from bottom)">
                              <Slider value={imgY} min={5} max={95} step={1} unit="%" onChange={setImgY} />
                            </Field>

                            <Button onClick={addImageAnnotation}>Add Image Annotation</Button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Tab: Rectangle */}
                    {activeTab === 'rect' && (
                      <div className={styles.card}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <Field label="Width (%)">
                            <Slider value={rectWidth} min={5} max={90} step={1} unit="%" onChange={setRectWidth} />
                          </Field>
                          <Field label="Height (%)">
                            <Slider value={rectHeight} min={2} max={80} step={1} unit="%" onChange={setRectHeight} />
                          </Field>
                        </div>

                        <div className={styles.colorPickerRow}>
                          <Field label="Border Color">
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={rectStroke}
                              onChange={(e) => setRectStroke(e.target.value)}
                            />
                          </Field>

                          <Field label="Fill">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" checked={hasFill} onChange={(e) => setHasFill(e.target.checked)} />
                              {hasFill && (
                                <input
                                  type="color"
                                  className={styles.colorInput}
                                  value={rectFill}
                                  onChange={(e) => setRectFill(e.target.value)}
                                />
                              )}
                            </div>
                          </Field>
                        </div>

                        <Field label="Border Width (px)">
                          <Slider value={rectStrokeWidth} min={1} max={10} step={1} unit="px" onChange={setRectStrokeWidth} />
                        </Field>

                        <Field label="Horizontal Position (X %)">
                          <Slider value={rectX} min={0} max={90} step={1} unit="%" onChange={setRectX} />
                        </Field>

                        <Field label="Vertical Position (Y % from bottom)">
                          <Slider value={rectY} min={5} max={95} step={1} unit="%" onChange={setRectY} />
                        </Field>

                        <Button onClick={addRectAnnotation}>Add Rectangle</Button>
                      </div>
                    )}

                    {/* Tab: Draw */}
                    {activeTab === 'drawing' && (
                      <div className={styles.card}>
                        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                          Draw directly over the page preview on the left using your mouse or touch.
                        </p>

                        <div className={styles.colorPickerRow}>
                          <Field label="Pen Color">
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={penColor}
                              onChange={(e) => setPenColor(e.target.value)}
                            />
                          </Field>

                          <Field label="Pen Width">
                            <Slider value={penWidth} min={1} max={16} step={1} unit="px" onChange={setPenWidth} />
                          </Field>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button variant="secondary" onClick={clearDrawing} disabled={!hasDrawnStrokes}>
                            Clear Drawing
                          </Button>
                          <Button onClick={addDrawingAnnotation} disabled={!hasDrawnStrokes}>
                            Add Drawing to Page
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Annotations List */}
                    <div className={styles.card}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Added Annotations ({annotations.length})</div>

                      {annotations.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                          No annotations added yet. Use the tools above to place text, images, rectangles, or drawings.
                        </p>
                      ) : (
                        <div className={styles.annList}>
                          {annotations.map((ann, idx) => (
                            <div key={ann.id} className={styles.annListItem}>
                              <span>
                                <strong>#{idx + 1}</strong> [Page {ann.pageNum}]{' '}
                                {ann.type === 'text'
                                  ? `Text "${ann.text.substring(0, 16)}"`
                                  : ann.type === 'rect'
                                    ? 'Rectangle'
                                    : ann.type === 'image'
                                      ? 'Image'
                                      : 'Freehand mark'}
                              </span>
                              <button className={styles.deleteBtn} onClick={() => removeAnnotation(ann.id)} title="Remove">
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {job.status === 'running' ? (
                      <ProgressBar value={job.progress} label="Applying annotations..." />
                    ) : (
                      <Button variant="primary" disabled={annotations.length === 0} onClick={handleApply}>
                        Apply Annotations & Save PDF
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
