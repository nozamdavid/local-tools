import React, { useState, useRef } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { formatOutputFile } from '../_basic';
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

const VIEWPORT_SIZE = 300; // px in preview

export default function CircleCropTool() {
  const meta = getToolMeta('img-circle-crop');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImg, setDecodedImg] = useState<HTMLImageElement | null>(null);
  const [shape, setShape] = useState<Shape>('circle');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasBorder, setHasBorder] = useState<boolean>(false);
  const [borderWidth, setBorderWidth] = useState<number>(4);
  const [borderColor, setBorderColor] = useState<string>('#ffffff');
  const [outputSize, setOutputSize] = useState<OutputSizeOption>('512');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CircleCropResult | null>(null);

  const dragStartRef = useRef<{ startX: number; startY: number; initialPan: { x: number; y: number } } | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setDecodedImg(null);
    setResultInfo(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    job.reset();

    try {
      const img = await decodeImage(selected);
      setDecodedImg(img);
    } catch {
      setMetaError('Could not decode image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setDecodedImg(null);
    setResultInfo(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMetaError(null);
    job.reset();
  };

  // Preview viewport dimensions
  const viewW = VIEWPORT_SIZE;
  const viewH = shape === 'circle' ? VIEWPORT_SIZE : Math.round(VIEWPORT_SIZE * 0.75);

  // Compute scale and position for preview display
  const baseScale = decodedImg
    ? Math.max(viewW / decodedImg.width, viewH / decodedImg.height)
    : 1;
  const totalScale = baseScale * zoom;
  const dispW = decodedImg ? Math.round(decodedImg.width * totalScale) : viewW;
  const dispH = decodedImg ? Math.round(decodedImg.height * totalScale) : viewH;

  const left = viewW / 2 - dispW / 2 + pan.x;
  const top = viewH / 2 - dispH / 2 + pan.y;

  // Pointer events for dragging
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPan: { ...pan },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setPan({
      x: dragStartRef.current.initialPan.x + dx,
      y: dragStartRef.current.initialPan.y + dy,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragStartRef.current = null;
    }
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
      const renderX = (viewW / 2 - dispW / 2 + pan.x) * ratio;
      const renderY = (viewH / 2 - dispH / 2 + pan.y) * ratio;
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
          label="Choose an image or drag it here"
          hint="Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={
                originalUrl ? (
                  <img src={originalUrl} alt={file.name} className="preview-media" />
                ) : null
              }
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  Shape: <strong>{shape === 'circle' ? 'Circle' : 'Ellipse'}</strong>
                </span>
                <span className="meta-chip">
                  Output: <strong>{resultInfo.width}×{resultInfo.height} px (PNG)</strong>
                </span>
              </div>
            </ResultPanel>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  Name: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {decodedImg && (
                  <span className="meta-chip">
                    Dimensions: <strong>{decodedImg.width}×{decodedImg.height} px</strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Cropping image..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Shape toggle */}
                  <Field label="Crop shape">
                    <div className={basicStyles.presetChips}>
                      <button
                        type="button"
                        className={`${basicStyles.presetChip} ${shape === 'circle' ? basicStyles.presetChipActive : ''}`}
                        onClick={() => setShape('circle')}
                      >
                        ⭕ Circle
                      </button>
                      <button
                        type="button"
                        className={`${basicStyles.presetChip} ${shape === 'ellipse' ? basicStyles.presetChipActive : ''}`}
                        onClick={() => setShape('ellipse')}
                      >
                        ⬭ Ellipse
                      </button>
                    </div>
                  </Field>

                  {/* Fixed circular / elliptical preview viewport */}
                  <div
                    className={`${circleStyles.previewContainer} ${shape === 'circle' ? circleStyles.circleMask : circleStyles.ellipseMask}`}
                    style={{ width: `${viewW}px`, height: `${viewH}px` }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  >
                    {originalUrl && (
                      <img
                        src={originalUrl}
                        alt="Draggable preview"
                        className={circleStyles.dragImage}
                        style={{
                          width: `${dispW}px`,
                          height: `${dispH}px`,
                          left: `${left}px`,
                          top: `${top}px`,
                        }}
                      />
                    )}
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
                    Drag image to reposition inside the {shape}. Use zoom slider below to resize.
                  </p>

                  {/* Zoom slider */}
                  <Field label="Zoom">
                    <Slider
                      value={zoom}
                      min={1}
                      max={4}
                      step={0.05}
                      unit="x"
                      onChange={setZoom}
                    />
                  </Field>

                  {/* Border ring controls */}
                  <Field label="Border ring">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={hasBorder}
                          onChange={(e) => setHasBorder(e.target.checked)}
                        />
                        <span>Enable border ring</span>
                      </label>

                      {hasBorder && (
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: '150px' }}>
                            <label className="field-label" style={{ fontSize: '0.8rem' }}>Width: {borderWidth}px</label>
                            <Slider
                              value={borderWidth}
                              min={1}
                              max={30}
                              step={1}
                              unit="px"
                              onChange={setBorderWidth}
                            />
                          </div>
                          <div>
                            <label className="field-label" style={{ fontSize: '0.8rem' }}>Color</label>
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
                  <Field label="Output size" hint="Choose resolution for transparent PNG export">
                    <Select
                      value={outputSize}
                      onChange={(e) => setOutputSize(e.target.value as OutputSizeOption)}
                      options={[
                        { value: '256', label: '256 px' },
                        { value: '512', label: '512 px (Recommended for avatars)' },
                        { value: '1024', label: '1024 px (High resolution)' },
                        { value: 'original', label: 'Original image dimension' },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleCrop}>
                      Crop {shape} (PNG)
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
