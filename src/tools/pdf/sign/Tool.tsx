import React, { useState, useRef, useEffect, useCallback } from 'react';
import { degrees } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { getVisualPageDims, mapVisualToPdf } from '../_stamp/coords';
import styles from './Tool.module.css';

type SignInputMode = 'draw' | 'type' | 'upload';
type PageTargetMode = 'last' | 'first' | 'all' | 'selected';

const TYPED_FONTS = [
  { name: 'Elegant', family: '"Brush Script MT", "Dancing Script", cursive' },
  { name: 'Handwriting', family: '"Caveat", "Segoe Script", cursive' },
  { name: 'Formal', family: '"Lucida Handwriting", "Snell Roundhand", cursive' },
  { name: 'Casual', family: 'cursive' },
];

export default function SignTool() {
  const meta = getToolMeta('pdf-sign');
  const source = usePdfSource();
  const job = useJob();

  const [inputMode, setInputMode] = useState<SignInputMode>('draw');

  // Draw state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(3);

  // Type state
  const [typedName, setTypedName] = useState('John Doe');
  const [selectedFont, setSelectedFont] = useState(TYPED_FONTS[0].family);
  const [typeColor, setTypeColor] = useState('#000000');

  // Upload state
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  // Active signature image URL & aspect ratio
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [sigAspect, setSigAspect] = useState<number>(0.35); // height / width

  // Placement state
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [targetMode, setTargetMode] = useState<PageTargetMode>('last');
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  // Position on visual page (percentage)
  const [xPercent, setXPercent] = useState(65); // 0 to 100
  const [yPercent, setYPercent] = useState(8);  // 0 to 100 from visual bottom
  const [widthPercent, setWidthPercent] = useState(25); // 10 to 60

  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ mouseX: 0, mouseY: 0, initX: 0, initY: 0 });

  const total = source.pages.length;

  // Sync default target page when document loads
  useEffect(() => {
    if (total > 0) {
      setPreviewPage(total); // default preview to the last page where signatures usually go
      setSelectedPages(new Set([total]));
    }
  }, [total]);

  // Generate typed signature when typedName, font, or color changes
  const updateTypedSignature = useCallback(() => {
    if (!typedName.trim()) return;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `64px ${selectedFont}`;
    ctx.fillStyle = typeColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(typedName, canvas.width / 2, canvas.height / 2);

    const dataUrl = canvas.toDataURL('image/png');
    setSignatureUrl(dataUrl);
    setSigAspect(200 / 600);
  }, [typedName, selectedFont, typeColor]);

  useEffect(() => {
    if (inputMode === 'type') {
      updateTypedSignature();
    }
  }, [inputMode, updateTypedSignature]);

  // Canvas drawing handlers
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);

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
    const canvas = canvasRef.current;
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
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setSignatureUrl(dataUrl);
      setSigAspect(canvas.height / canvas.width);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureUrl(null);
  };

  const handleUploadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setUploadedUrl(result);
      setSignatureUrl(result);
      const img = new Image();
      img.onload = () => {
        setSigAspect(img.naturalHeight / img.naturalWidth);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
  };

  // Dragging signature on preview
  const handlePointerDownSig = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initX: xPercent,
      initY: yPercent,
    };
  };

  const handlePointerMoveSig = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !previewBoxRef.current) return;
    const rect = previewBoxRef.current.getBoundingClientRect();
    const deltaX = ((e.clientX - dragStartPos.current.mouseX) / rect.width) * 100;
    // mouseY increases downwards, but yPercent is from bottom upwards
    const deltaY = -(((e.clientY - dragStartPos.current.mouseY) / rect.height) * 100);

    const newX = Math.min(Math.max(0, dragStartPos.current.initX + deltaX), 100 - widthPercent);
    const heightPercent = widthPercent * sigAspect;
    const newY = Math.min(Math.max(0, dragStartPos.current.initY + deltaY), 100 - heightPercent);

    setXPercent(Math.round(newX));
    setYPercent(Math.round(newY));
  };

  const handlePointerUpSig = () => {
    isDraggingRef.current = false;
  };

  // Presets
  const setPreset = (pos: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'center' | 'top-right') => {
    const h = widthPercent * sigAspect;
    switch (pos) {
      case 'bottom-right':
        setXPercent(Math.max(0, 100 - widthPercent - 5));
        setYPercent(6);
        break;
      case 'bottom-left':
        setXPercent(6);
        setYPercent(6);
        break;
      case 'bottom-center':
        setXPercent(Math.max(0, (100 - widthPercent) / 2));
        setYPercent(6);
        break;
      case 'center':
        setXPercent(Math.max(0, (100 - widthPercent) / 2));
        setYPercent(Math.max(0, (100 - h) / 2));
        break;
      case 'top-right':
        setXPercent(Math.max(0, 100 - widthPercent - 5));
        setYPercent(Math.max(0, 100 - h - 6));
        break;
    }
  };

  // Determine target pages list
  const getResolvedTargetPages = (): number[] => {
    if (targetMode === 'last') return total > 0 ? [total] : [];
    if (targetMode === 'first') return total > 0 ? [1] : [];
    if (targetMode === 'all') return Array.from({ length: total }, (_, i) => i + 1);
    if (targetMode === 'selected') return Array.from(selectedPages).sort((a, b) => a - b);
    return [];
  };

  const targetPageList = getResolvedTargetPages();
  const targetPageSet = new Set(targetPageList);

  const toggleSelectedPage = (pNum: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pNum)) next.delete(pNum);
      else next.add(pNum);
      return next;
    });
  };

  const handleApply = () => {
    if (!signatureUrl || targetPageList.length === 0) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();

      // Convert data URL to PNG bytes
      const response = await fetch(signatureUrl);
      const pngBlob = await response.blob();
      const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
      const embeddedSig = await pdf.embedPng(pngBytes);

      setProgress(0.4);

      const pages = pdf.getPages();
      const totalDocPages = pages.length;

      for (let pNum = 1; pNum <= totalDocPages; pNum++) {
        if (!targetPageSet.has(pNum)) continue;

        const page = pages[pNum - 1];
        const dims = getVisualPageDims(page);

        // Visual width and height
        const wv = dims.visualWidth * (widthPercent / 100);
        const hv = wv * (embeddedSig.height / embeddedSig.width);

        // Visual origin (bottom-left)
        const xv = dims.visualWidth * (xPercent / 100);
        const yv = dims.visualHeight * (yPercent / 100);

        const placement = mapVisualToPdf({ x: xv, y: yv, angle: 0 }, dims);

        page.drawImage(embeddedSig, {
          x: placement.x,
          y: placement.y,
          width: wv,
          height: hv,
          rotate: degrees(placement.rotateDegrees),
        });
      }

      setProgress(0.85);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-signed.pdf` : 'signed.pdf';
  const previewThumb = source.thumbs[previewPage - 1];

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && (
        <PasswordDialog
          reason={source.password.reason}
          onSubmit={source.password.submit}
          onCancel={handleReset}
        />
      )}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Draw, type or upload your signature and place it on any page. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <PdfPreview
              blob={job.result}
              filename={outName}
              pageCount={total}
              onReset={handleReset}
            />
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
                <strong>Visual signature only:</strong> This tool places a visual signature image stamp on selected PDF pages. It does not create or attach a cryptographic / PKI digital signature certificate.
              </div>

              {source.loading && <p className={styles.status}>Opening PDF document…</p>}

              {source.doc && (
                <>
                  <div className={styles.tabGroup}>
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${inputMode === 'draw' ? styles.tabBtnActive : ''}`}
                      onClick={() => setInputMode('draw')}
                    >
                      ✏️ Draw signature
                    </button>
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${inputMode === 'type' ? styles.tabBtnActive : ''}`}
                      onClick={() => setInputMode('type')}
                    >
                      ⌨️ Type signature
                    </button>
                    <button
                      type="button"
                      className={`${styles.tabBtn} ${inputMode === 'upload' ? styles.tabBtnActive : ''}`}
                      onClick={() => setInputMode('upload')}
                    >
                      📁 Upload signature
                    </button>
                  </div>

                  {inputMode === 'draw' && (
                    <div className={styles.drawCanvasWrapper}>
                      <canvas
                        ref={canvasRef}
                        width={500}
                        height={160}
                        className={styles.drawCanvas}
                        onPointerDown={startDrawing}
                        onPointerMove={draw}
                        onPointerUp={stopDrawing}
                      />
                      <div className={styles.canvasTools}>
                        <div className={styles.colorPicker}>
                          <button
                            type="button"
                            className={`${styles.colorDot} ${penColor === '#000000' ? styles.colorDotActive : ''}`}
                            style={{ backgroundColor: '#000000' }}
                            onClick={() => setPenColor('#000000')}
                            aria-label="Black pen"
                          />
                          <button
                            type="button"
                            className={`${styles.colorDot} ${penColor === '#002b80' ? styles.colorDotActive : ''}`}
                            style={{ backgroundColor: '#002b80' }}
                            onClick={() => setPenColor('#002b80')}
                            aria-label="Blue pen"
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.85rem' }}>Width:</span>
                          <input
                            type="range"
                            min={1}
                            max={6}
                            value={penWidth}
                            onChange={(e) => setPenWidth(Number(e.target.value))}
                            style={{ width: '80px' }}
                          />
                        </div>
                        <Button variant="secondary" onClick={clearCanvas}>
                          Clear signature
                        </Button>
                      </div>
                    </div>
                  )}

                  {inputMode === 'type' && (
                    <div className={styles.typeSection}>
                      <Field label="Your Name">
                        <input
                          type="text"
                          className={styles.textInput}
                          value={typedName}
                          onChange={(e) => setTypedName(e.target.value)}
                          placeholder="Type your name"
                        />
                      </Field>

                      <Field label="Choose Signature Style">
                        <div className={styles.fontPicker}>
                          {TYPED_FONTS.map((font) => (
                            <div
                              key={font.name}
                              className={`${styles.fontCard} ${selectedFont === font.family ? styles.fontCardActive : ''}`}
                              style={{ fontFamily: font.family }}
                              onClick={() => setSelectedFont(font.family)}
                            >
                              {typedName || 'Signature'}
                            </div>
                          ))}
                        </div>
                      </Field>

                      <div className={styles.canvasTools}>
                        <div className={styles.colorPicker}>
                          <button
                            type="button"
                            className={`${styles.colorDot} ${typeColor === '#000000' ? styles.colorDotActive : ''}`}
                            style={{ backgroundColor: '#000000' }}
                            onClick={() => setTypeColor('#000000')}
                            aria-label="Black ink"
                          />
                          <button
                            type="button"
                            className={`${styles.colorDot} ${typeColor === '#002b80' ? styles.colorDotActive : ''}`}
                            style={{ backgroundColor: '#002b80' }}
                            onClick={() => setTypeColor('#002b80')}
                            aria-label="Blue ink"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {inputMode === 'upload' && (
                    <div className={styles.uploadSection} onClick={() => uploadInputRef.current?.click()}>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadFile(f);
                        }}
                      />
                      {uploadedUrl ? (
                        <div>
                          <img src={uploadedUrl} alt="Uploaded signature" className={styles.uploadPreview} />
                          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                            Click to choose a different signature image
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontWeight: 600 }}>Click to upload signature image</p>
                          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                            Supports transparent PNG, JPG, or SVG
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={styles.placementSection}>
                    <h3>Position & Pages Preview</h3>
                    <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
                      Drag the signature in the preview below to place it, or use the position controls.
                    </p>

                    <div className={styles.placementGrid}>
                      <div>
                        <div
                          ref={previewBoxRef}
                          className={styles.previewInteractiveBox}
                          onPointerMove={handlePointerMoveSig}
                          onPointerUp={handlePointerUpSig}
                        >
                          {previewThumb ? (
                            <img
                              src={previewThumb}
                              alt={`Page ${previewPage}`}
                              className={styles.previewPageImage}
                              draggable={false}
                            />
                          ) : (
                            <div style={{ padding: '4rem', color: 'var(--color-text-muted)' }}>
                              Loading page {previewPage}…
                            </div>
                          )}

                          {signatureUrl && (
                            <div
                              className={styles.signatureOverlay}
                              style={{
                                left: `${xPercent}%`,
                                bottom: `${yPercent}%`,
                                width: `${widthPercent}%`,
                                height: `${widthPercent * sigAspect}%`,
                              }}
                              onPointerDown={handlePointerDownSig}
                            >
                              <img
                                src={signatureUrl}
                                alt="Signature preview"
                                className={styles.signatureOverlayImg}
                                draggable={false}
                              />
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                          <Button
                            variant="secondary"
                            disabled={previewPage <= 1}
                            onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                          >
                            ‹ Prev
                          </Button>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                            Previewing page {previewPage} of {total}
                          </span>
                          <Button
                            variant="secondary"
                            disabled={previewPage >= total}
                            onClick={() => setPreviewPage((p) => Math.min(total, p + 1))}
                          >
                            Next ›
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Field label="Signature Size">
                          <Slider
                            value={widthPercent}
                            min={10}
                            max={60}
                            step={2}
                            unit="%"
                            onChange={setWidthPercent}
                          />
                        </Field>

                        <Field label="Quick Position Presets">
                          <div className={styles.presetButtons}>
                            <button
                              type="button"
                              className={styles.presetBtn}
                              onClick={() => setPreset('bottom-right')}
                            >
                              Bottom Right
                            </button>
                            <button
                              type="button"
                              className={styles.presetBtn}
                              onClick={() => setPreset('bottom-center')}
                            >
                              Bottom Center
                            </button>
                            <button
                              type="button"
                              className={styles.presetBtn}
                              onClick={() => setPreset('bottom-left')}
                            >
                              Bottom Left
                            </button>
                            <button
                              type="button"
                              className={styles.presetBtn}
                              onClick={() => setPreset('center')}
                            >
                              Center
                            </button>
                            <button
                              type="button"
                              className={styles.presetBtn}
                              onClick={() => setPreset('top-right')}
                            >
                              Top Right
                            </button>
                          </div>
                        </Field>

                        <Field label="Target Pages">
                          <div className={styles.scopeOptions}>
                            <label>
                              <input
                                type="radio"
                                name="targetMode"
                                checked={targetMode === 'last'}
                                onChange={() => setTargetMode('last')}
                              />
                              Last page only
                            </label>
                            <label>
                              <input
                                type="radio"
                                name="targetMode"
                                checked={targetMode === 'first'}
                                onChange={() => setTargetMode('first')}
                              />
                              First page only
                            </label>
                            <label>
                              <input
                                type="radio"
                                name="targetMode"
                                checked={targetMode === 'all'}
                                onChange={() => setTargetMode('all')}
                              />
                              All pages
                            </label>
                            <label>
                              <input
                                type="radio"
                                name="targetMode"
                                checked={targetMode === 'selected'}
                                onChange={() => setTargetMode('selected')}
                              />
                              Pick pages
                            </label>
                          </div>

                          {targetMode === 'selected' && (
                            <div className={styles.pagePickerGrid}>
                              {Array.from({ length: total }, (_, i) => i + 1).map((pNum) => {
                                const isSel = selectedPages.has(pNum);
                                return (
                                  <div
                                    key={pNum}
                                    className={`${styles.pageMiniCard} ${isSel ? styles.pageMiniCardSelected : ''}`}
                                    onClick={() => toggleSelectedPage(pNum)}
                                  >
                                    Page {pNum}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </Field>
                      </div>
                    </div>
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Applying signature to PDF…" />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.75rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleApply}
                        disabled={!signatureUrl || targetPageList.length === 0}
                      >
                        Sign {targetPageList.length} {targetPageList.length === 1 ? 'page' : 'pages'}
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
