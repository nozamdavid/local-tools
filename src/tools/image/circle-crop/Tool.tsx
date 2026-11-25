import React, { useState, useRef, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { formatOutputFile } from '../_basic';
import { createBoundedPngPreview } from '../_basic/previews';
import circleStyles from './CircleCrop.module.css';
import basicStyles from '../_basic/basic.module.css';

type Shape = 'circle' | 'ellipse';
type OutputSizeOption = '256' | '512' | '1024' | 'original';

interface CircleCropResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

const VIEWPORT_SIZE = 300; // editor coordinate units; measured again when the viewport is constrained.

function constrainPan(pan: { x: number; y: number }, imageWidth: number, imageHeight: number, viewWidth: number, viewHeight: number) {
  return {
    x: Math.max(viewWidth - imageWidth, Math.min(0, pan.x)),
    y: Math.max(viewHeight - imageHeight, Math.min(0, pan.y)),
  };
}

export default function CircleCropTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-circle-crop');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImg, setDecodedImg] = useState<HTMLImageElement | null>(null);
  const [editorPreviewBlob, setEditorPreviewBlob] = useState<Blob | null>(null);
  const [editorPreviewError, setEditorPreviewError] = useState(false);
  const [shape, setShape] = useState<Shape>('circle');
  const shapeLabel = shape === 'circle' ? t('Circle') : t('Ellipse');
  const [zoom, setZoom] = useState<number>(1);
  const [viewW, setViewW] = useState<number>(VIEWPORT_SIZE);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasBorder, setHasBorder] = useState<boolean>(false);
  const [borderWidth, setBorderWidth] = useState<number>(4);
  const [borderColor, setBorderColor] = useState<string>('#ffffff');
  const [outputSize, setOutputSize] = useState<OutputSizeOption>('512');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CircleCropResult | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; initialPan: { x: number; y: number } } | null>(null);
  const loadSequenceRef = useRef(0);

  const job = useJob();
  const editorPreviewUrl = useObjectUrl(editorPreviewBlob);

  useEffect(
    () => () => {
      loadSequenceRef.current += 1;
      dragStartRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (job.status === 'done') setDecodedImg(null);
  }, [job.status]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const sequence = ++loadSequenceRef.current;
    setFile(selected);
    setMetaError(null);
    setDecodedImg(null);
    setEditorPreviewBlob(null);
    setEditorPreviewError(false);
    setResultInfo(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    job.reset();

    try {
      const img = await decodeImage(selected);
      if (sequence !== loadSequenceRef.current) return;
      setDecodedImg(img);
      try {
        const previewBlob = await createBoundedPngPreview(img, img.width, img.height, 1280);
        if (sequence === loadSequenceRef.current) setEditorPreviewBlob(previewBlob);
      } catch {
        if (sequence === loadSequenceRef.current) setEditorPreviewError(true);
      }
    } catch {
      if (sequence === loadSequenceRef.current) setMetaError(t('Could not decode image. The file may be corrupt or unsupported.'));
    }
  };

  const handleReset = () => {
    loadSequenceRef.current += 1;
    dragStartRef.current = null;
    setFile(null);
    setDecodedImg(null);
    setEditorPreviewBlob(null);
    setEditorPreviewError(false);
    setResultInfo(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMetaError(null);
    job.reset();
  };

  // Preview viewport dimensions
  const viewH = shape === 'circle' ? viewW : Math.round(viewW * 0.75);

  // Compute scale and position for preview display
  const baseScale = decodedImg ? Math.max(viewW / decodedImg.width, viewH / decodedImg.height) : 1;
  const totalScale = baseScale * zoom;
  const dispW = decodedImg ? Math.round(decodedImg.width * totalScale) : viewW;
  const dispH = decodedImg ? Math.round(decodedImg.height * totalScale) : viewH;

  const boundedPan = constrainPan(pan, dispW, dispH, viewW, viewH);
  const left = viewW / 2 - dispW / 2 + boundedPan.x;
  const top = viewH / 2 - dispH / 2 + boundedPan.y;

  useEffect(() => {
    const viewport = previewRef.current;
    if (!viewport) return;
    const measure = () => {
      const width = Math.round(viewport.clientWidth);
      if (width > 0) setViewW(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [file, shape]);

  useEffect(() => {
    setPan((current) => constrainPan(current, dispW, dispH, viewW, viewH));
  }, [dispH, dispW, viewH, viewW]);

  // Pointer events for dragging
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!decodedImg) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      initialPan: { ...boundedPan },
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setPan(
      constrainPan(
        {
          x: dragStartRef.current.initialPan.x + dx,
          y: dragStartRef.current.initialPan.y + dy,
        },
        dispW,
        dispH,
        viewW,
        viewH,
      ),
    );
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId !== e.pointerId) return;
    dragStartRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released after cancellation.
    }
  };

  const onPreviewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!decodedImg || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    setPan(constrainPan({ x: boundedPan.x + dx, y: boundedPan.y + dy }, dispW, dispH, viewW, viewH));
  };

  const handleCrop = () => {
    if (!file || !decodedImg) return;

    job.run(async (setProgress) => {
      setProgress(0.2);

      // Determine output resolution
      let outW: number;
      let outH: number;

      if (outputSize === 'original') {
        if (shape === 'circle') {
          const dim = Math.min(decodedImg.width, decodedImg.height);
          outW = dim;
          outH = dim;
        } else {
          outW = decodedImg.width;
          outH = Math.round(decodedImg.width * 0.75);
        }
      } else {
        const sz = parseInt(outputSize, 10);
        outW = sz;
        outH = shape === 'circle' ? sz : Math.round(sz * 0.75);
      }

      const ratio = outW / viewW;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Clip path
      ctx.save();
      ctx.beginPath();
      if (shape === 'circle') {
        ctx.arc(outW / 2, outH / 2, outW / 2, 0, Math.PI * 2);
      } else {
        ctx.ellipse(outW / 2, outH / 2, outW / 2, outH / 2, 0, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.clip();

      // Draw image
      const renderX = (viewW / 2 - dispW / 2 + boundedPan.x) * ratio;
      const renderY = (viewH / 2 - dispH / 2 + boundedPan.y) * ratio;
      const renderW = dispW * ratio;
      const renderH = dispH * ratio;

      ctx.drawImage(decodedImg, renderX, renderY, renderW, renderH);
      ctx.restore();

      // Draw optional border ring
      if (hasBorder && borderWidth > 0) {
        const ringWidth = borderWidth * ratio;
        ctx.beginPath();
        if (shape === 'circle') {
          ctx.arc(outW / 2, outH / 2, outW / 2 - ringWidth / 2, 0, Math.PI * 2);
        } else {
          ctx.ellipse(outW / 2, outH / 2, outW / 2 - ringWidth / 2, outH / 2 - ringWidth / 2, 0, 0, Math.PI * 2);
        }
        ctx.lineWidth = ringWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
      }

      setProgress(0.7);

      // Output PNG with transparency
      const blob = await canvasToBlob(canvas, 'image/png');
      setProgress(1.0);

      const info: CircleCropResult = {
        blob,
        filename: formatOutputFile(file.name, `-${shape}-crop`, 'png'),
        width: outW,
        height: outH,
      };
      setResultInfo(info);
      return blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-circle-crop">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or drag it here')}
          hint={t('Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={editorPreviewUrl ? <img src={editorPreviewUrl} alt={file.name} className="preview-media" /> : null}
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  {t('Shape')}: <strong>{shape === 'circle' ? t('Circle') : t('Ellipse')}</strong>
                </span>
                <span className="meta-chip">
                  {t('Output')}:{' '}
                  <strong>
                    {resultInfo.width}×{resultInfo.height} px (PNG)
                  </strong>
                </span>
              </div>
            </ResultPanel>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name')}: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
                {decodedImg && (
                  <span className="meta-chip">
                    {t('Dimensions')}:{' '}
                    <strong>
                      {decodedImg.width}×{decodedImg.height} px
                    </strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Cropping image...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Shape toggle */}
                  <Field label={t('Crop shape')}>
                    <div className={basicStyles.presetChips}>
                      <button
                        type="button"
                        className={`${basicStyles.presetChip} ${shape === 'circle' ? basicStyles.presetChipActive : ''}`}
                        onClick={() => setShape('circle')}
                      >
                        ⭕ {t('Circle')}
                      </button>
                      <button
                        type="button"
                        className={`${basicStyles.presetChip} ${shape === 'ellipse' ? basicStyles.presetChipActive : ''}`}
                        onClick={() => setShape('ellipse')}
                      >
                        ⬭ {t('Ellipse')}
                      </button>
                    </div>
                  </Field>

                  {/* Fixed circular / elliptical preview viewport */}
                  <div
                    ref={previewRef}
                    className={`${circleStyles.previewContainer} ${shape === 'circle' ? circleStyles.circleMask : circleStyles.ellipseMask}`}
                    style={{ width: `${viewW + 2}px`, height: `${viewH + 2}px` }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={finishPointer}
                    onPointerCancel={finishPointer}
                    onLostPointerCapture={finishPointer}
                    onKeyDown={onPreviewKeyDown}
                    tabIndex={0}
                    role="group"
                    aria-label={t('Crop preview. Drag to reposition. Use arrow keys to move the image.')}
                  >
                    {decodedImg && editorPreviewUrl ? (
                      <img
                        src={editorPreviewUrl}
                        alt={t('Draggable preview')}
                        className={circleStyles.dragImage}
                        style={{
                          width: `${dispW}px`,
                          height: `${dispH}px`,
                          left: `${left}px`,
                          top: `${top}px`,
                        }}
                      />
                    ) : decodedImg && editorPreviewError ? (
                      <span className={circleStyles.previewUnavailable}>{t('Image preview is unavailable; choose another image.')}</span>
                    ) : decodedImg ? (
                      <span className={circleStyles.previewUnavailable} role="status">
                        {t('Loading image…')}
                      </span>
                    ) : null}
                    {hasBorder && (
                      <div
                        className={`${circleStyles.overlayRing} ${shape === 'circle' ? circleStyles.circleMask : circleStyles.ellipseMask}`}
                        style={{
                          border: `${borderWidth}px solid ${borderColor}`,
                        }}
                      />
                    )}
                  </div>

                  <p className="field-hint" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    {t('Drag image to reposition inside the {shape}. Use zoom slider below to resize.', { shape: shapeLabel })}
                  </p>

                  {/* Zoom slider */}
                  <Field label={t('Zoom')}>
                    <Slider value={zoom} min={1} max={4} step={0.05} unit="x" onChange={setZoom} />
                  </Field>

                  {/* Border ring controls */}
                  <Field label={t('Border ring')}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={hasBorder} onChange={(e) => setHasBorder(e.target.checked)} />
                        <span>{t('Enable border ring')}</span>
                      </label>

                      {hasBorder && (
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: '150px' }}>
                            <label className="field-label" style={{ fontSize: '0.8rem' }}>
                              {t('Width: {width}px', { width: borderWidth })}
                            </label>
                            <Slider value={borderWidth} min={1} max={30} step={1} unit="px" onChange={setBorderWidth} />
                          </div>
                          <div>
                            <label className="field-label" style={{ fontSize: '0.8rem' }}>
                              {t('Color')}
                            </label>
                            <input
                              type="color"
                              value={borderColor}
                              onChange={(e) => setBorderColor(e.target.value)}
                              style={{ width: '48px', height: '36px', padding: 0, border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </Field>

                  {/* Output size select */}
                  <Field label={t('Output size')} hint={t('Choose resolution for transparent PNG export')}>
                    <Select
                      value={outputSize}
                      onChange={(e) => setOutputSize(e.target.value as OutputSizeOption)}
                      options={[
                        { value: '256', label: t('256 px') },
                        { value: '512', label: t('512 px (Recommended for avatars)') },
                        { value: '1024', label: t('1024 px (High resolution)') },
                        { value: 'original', label: t('Original image dimension') },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different image')}
                    </Button>
                    <Button variant="primary" onClick={handleCrop} disabled={!decodedImg || !editorPreviewUrl}>
                      {t('Crop {shape} (PNG)', { shape: shapeLabel })}
                    </Button>
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
