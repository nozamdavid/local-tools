import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getDefaultFormat, formatOutputFile } from '../_basic';
import cropStyles from './Crop.module.css';
import basicStyles from '../_basic/basic.module.css';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AspectPreset {
  label: string;
  ratio: number | null; // null for Free
}

const PRESETS: AspectPreset[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:5', ratio: 4 / 5 },
];

type DragMode = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w';

interface CropResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export default function CropTool() {
  const meta = getToolMeta('img-crop');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImg, setDecodedImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 100, height: 100 });
  const [aspect, setAspect] = useState<number | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CropResult | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dispScale, setDispScale] = useState<number>(1);

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    initialCrop: CropRect;
  } | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const updateDisplayScale = useCallback(() => {
    if (imgRef.current && decodedImg && decodedImg.width > 0) {
      const clientW = imgRef.current.clientWidth;
      setDispScale(clientW / decodedImg.width);
    }
  }, [decodedImg]);

  useEffect(() => {
    updateDisplayScale();
    window.addEventListener('resize', updateDisplayScale);
    return () => window.removeEventListener('resize', updateDisplayScale);
  }, [updateDisplayScale]);

  const initCropForAspect = useCallback((imgW: number, imgH: number, ratio: number | null): CropRect => {
    if (!ratio) {
      // 80% centered
      const w = Math.round(imgW * 0.8);
      const h = Math.round(imgH * 0.8);
      return {
        x: Math.round((imgW - w) / 2),
        y: Math.round((imgH - h) / 2),
        width: w,
        height: h,
      };
    }

    let w: number;
    let h: number;
    if (imgW / imgH > ratio) {
      h = Math.round(imgH * 0.8);
      w = Math.round(h * ratio);
    } else {
      w = Math.round(imgW * 0.8);
      h = Math.round(w / ratio);
    }
    return {
      x: Math.round((imgW - w) / 2),
      y: Math.round((imgH - h) / 2),
      width: Math.max(10, w),
      height: Math.max(10, h),
    };
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setDecodedImg(null);
    setResultInfo(null);
    job.reset();

    try {
      const img = await decodeImage(selected);
      setDecodedImg(img);
      setCrop(initCropForAspect(img.width, img.height, aspect));
    } catch {
      setMetaError('Could not decode image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setDecodedImg(null);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const handleSelectAspect = (ratio: number | null) => {
    setAspect(ratio);
    if (decodedImg) {
      setCrop(initCropForAspect(decodedImg.width, decodedImg.height, ratio));
    }
  };

  // Pointer event handlers for drag / resize
  const onPointerDown = (e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialCrop: { ...crop },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !decodedImg || dispScale <= 0) return;
    e.preventDefault();

    const { mode, startX, startY, initialCrop } = dragRef.current;
    const dx = (e.clientX - startX) / dispScale;
    const dy = (e.clientY - startY) / dispScale;

    const imgW = decodedImg.width;
    const imgH = decodedImg.height;

    let newCrop = { ...initialCrop };

    if (mode === 'move') {
      newCrop.x = Math.max(0, Math.min(imgW - initialCrop.width, Math.round(initialCrop.x + dx)));
      newCrop.y = Math.max(0, Math.min(imgH - initialCrop.height, Math.round(initialCrop.y + dy)));
    } else {
      let x1 = initialCrop.x;
      let y1 = initialCrop.y;
      let x2 = initialCrop.x + initialCrop.width;
      let y2 = initialCrop.y + initialCrop.height;

      if (mode.includes('w')) x1 = Math.min(x2 - 10, Math.max(0, Math.round(initialCrop.x + dx)));
      if (mode.includes('e')) x2 = Math.max(x1 + 10, Math.min(imgW, Math.round(initialCrop.x + initialCrop.width + dx)));
      if (mode.includes('n')) y1 = Math.min(y2 - 10, Math.max(0, Math.round(initialCrop.y + dy)));
      if (mode.includes('s')) y2 = Math.max(y1 + 10, Math.min(imgH, Math.round(initialCrop.y + initialCrop.height + dy)));

      let w = x2 - x1;
      let h = y2 - y1;

      if (aspect) {
        if (mode === 'e' || mode === 'w') {
          h = Math.round(w / aspect);
          y2 = Math.min(imgH, y1 + h);
          w = Math.round((y2 - y1) * aspect);
        } else {
          w = Math.round(h * aspect);
          if (x1 + w > imgW) {
            w = imgW - x1;
            h = Math.round(w / aspect);
          }
        }
      }

      newCrop = {
        x: Math.max(0, Math.min(imgW - 10, x1)),
        y: Math.max(0, Math.min(imgH - 10, y1)),
        width: Math.max(10, Math.min(imgW - x1, w)),
        height: Math.max(10, Math.min(imgH - y1, h)),
      };
    }

    setCrop(newCrop);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = null;
    }
  };

  const updateNumeric = (key: keyof CropRect, val: number) => {
    if (!decodedImg) return;
    const clampedVal = Math.max(0, val);
    const updated = { ...crop, [key]: clampedVal };

    if (key === 'x') updated.x = Math.min(decodedImg.width - updated.width, clampedVal);
    if (key === 'y') updated.y = Math.min(decodedImg.height - updated.height, clampedVal);
    if (key === 'width') updated.width = Math.min(decodedImg.width - updated.x, Math.max(10, clampedVal));
    if (key === 'height') updated.height = Math.min(decodedImg.height - updated.y, Math.max(10, clampedVal));

    if (aspect) {
      if (key === 'width') {
        updated.height = Math.max(10, Math.min(decodedImg.height - updated.y, Math.round(updated.width / aspect)));
      } else if (key === 'height') {
        updated.width = Math.max(10, Math.min(decodedImg.width - updated.x, Math.round(updated.height * aspect)));
      }
    }

    setCrop(updated);
  };

  const handleApplyCrop = () => {
    if (!file || !decodedImg || crop.width <= 0 || crop.height <= 0) return;

    job.run(async (setProgress) => {
      setProgress(0.2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(crop.width);
      canvas.height = Math.round(crop.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(
        decodedImg,
        Math.round(crop.x),
        Math.round(crop.y),
        Math.round(crop.width),
        Math.round(crop.height),
        0,
        0,
        canvas.width,
        canvas.height,
      );
      setProgress(0.6);

      const defaultFmt = getDefaultFormat(file, 'image/png');
      const mime: EncodableMime = defaultFmt.mime;
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';

      const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? undefined : 0.92);
      setProgress(1.0);

      const info: CropResult = {
        blob,
        filename: formatOutputFile(file.name, '-cropped', ext),
        width: canvas.width,
        height: canvas.height,
      };
      setResultInfo(info);
      return blob;
    });
  };

  const boxStyle: React.CSSProperties = {
    left: `${crop.x * dispScale}px`,
    top: `${crop.y * dispScale}px`,
    width: `${crop.width * dispScale}px`,
    height: `${crop.height * dispScale}px`,
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-crop">
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
              beforePreview={originalUrl ? <img src={originalUrl} alt={file.name} className="preview-media" /> : null}
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  Cropped dimensions:{' '}
                  <strong>
                    {resultInfo.width}×{resultInfo.height} px
                  </strong>
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
                    Dimensions:{' '}
                    <strong>
                      {decodedImg.width}×{decodedImg.height} px
                    </strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Cropping image..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Aspect ratio presets */}
                  <Field label="Aspect ratio">
                    <div className={basicStyles.presetChips}>
                      {PRESETS.map((p) => {
                        const isActive = aspect === p.ratio;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`${basicStyles.presetChip} ${isActive ? basicStyles.presetChipActive : ''}`}
                            onClick={() => handleSelectAspect(p.ratio)}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  {/* Crop editor canvas/image */}
                  <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <div className={cropStyles.cropWrapper}>
                      {originalUrl && (
                        <img
                          ref={imgRef}
                          src={originalUrl}
                          alt="Crop preview"
                          className={cropStyles.cropImage}
                          onLoad={updateDisplayScale}
                        />
                      )}
                      <div
                        className={cropStyles.cropBox}
                        style={boxStyle}
                        onPointerDown={(e) => onPointerDown(e, 'move')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                      >
                        <div className={`${cropStyles.handle} ${cropStyles.handleNw}`} onPointerDown={(e) => onPointerDown(e, 'nw')} />
                        <div className={`${cropStyles.handle} ${cropStyles.handleNe}`} onPointerDown={(e) => onPointerDown(e, 'ne')} />
                        <div className={`${cropStyles.handle} ${cropStyles.handleSw}`} onPointerDown={(e) => onPointerDown(e, 'sw')} />
                        <div className={`${cropStyles.handle} ${cropStyles.handleSe}`} onPointerDown={(e) => onPointerDown(e, 'se')} />
                        {!aspect && (
                          <>
                            <div className={`${cropStyles.handle} ${cropStyles.handleN}`} onPointerDown={(e) => onPointerDown(e, 'n')} />
                            <div className={`${cropStyles.handle} ${cropStyles.handleS}`} onPointerDown={(e) => onPointerDown(e, 's')} />
                            <div className={`${cropStyles.handle} ${cropStyles.handleW}`} onPointerDown={(e) => onPointerDown(e, 'w')} />
                            <div className={`${cropStyles.handle} ${cropStyles.handleE}`} onPointerDown={(e) => onPointerDown(e, 'e')} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Numeric Inputs in source pixels */}
                  <Field label="Crop coordinates (source pixels)">
                    <div className={cropStyles.inputsGrid}>
                      <div>
                        <label className="field-label" style={{ fontSize: '0.8rem' }}>
                          X (px)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={decodedImg?.width || 10000}
                          value={Math.round(crop.x)}
                          onChange={(e) => updateNumeric('x', parseInt(e.target.value, 10) || 0)}
                          className={basicStyles.inputNumber}
                        />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '0.8rem' }}>
                          Y (px)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={decodedImg?.height || 10000}
                          value={Math.round(crop.y)}
                          onChange={(e) => updateNumeric('y', parseInt(e.target.value, 10) || 0)}
                          className={basicStyles.inputNumber}
                        />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '0.8rem' }}>
                          Width (px)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={decodedImg?.width || 10000}
                          value={Math.round(crop.width)}
                          onChange={(e) => updateNumeric('width', parseInt(e.target.value, 10) || 10)}
                          className={basicStyles.inputNumber}
                        />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '0.8rem' }}>
                          Height (px)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={decodedImg?.height || 10000}
                          value={Math.round(crop.height)}
                          onChange={(e) => updateNumeric('height', parseInt(e.target.value, 10) || 10)}
                          className={basicStyles.inputNumber}
                        />
                      </div>
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleApplyCrop}>
                      Crop image
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
