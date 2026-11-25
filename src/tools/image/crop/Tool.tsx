import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getDefaultFormat, formatOutputFile } from '../_basic';
import { createBoundedPngPreview } from '../_basic/previews';
import cropStyles from './Crop.module.css';
import basicStyles from '../_basic/basic.module.css';
import { clampCrop, createCropSelection, moveCrop, resizeCrop, updateCropValue, type CropDragMode, type CropRect } from './geometry';

interface AspectPreset {
  label: string;
  ratio: number | null;
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

const HANDLES: Exclude<CropDragMode, 'draw' | 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_LABELS: Record<(typeof HANDLES)[number], string> = {
  nw: 'Resize crop from top left',
  n: 'Resize crop from top',
  ne: 'Resize crop from top right',
  e: 'Resize crop from right',
  se: 'Resize crop from bottom right',
  s: 'Resize crop from bottom',
  sw: 'Resize crop from bottom left',
  w: 'Resize crop from left',
};
const HANDLE_CLASSES: Record<(typeof HANDLES)[number], string> = {
  nw: cropStyles.handleNw,
  n: cropStyles.handleN,
  ne: cropStyles.handleNe,
  e: cropStyles.handleE,
  se: cropStyles.handleSe,
  s: cropStyles.handleS,
  sw: cropStyles.handleSw,
  w: cropStyles.handleW,
};

interface CropResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export default function CropTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-crop');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImg, setDecodedImg] = useState<HTMLImageElement | null>(null);
  const [editorPreviewBlob, setEditorPreviewBlob] = useState<Blob | null>(null);
  const [editorPreviewError, setEditorPreviewError] = useState(false);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [aspect, setAspect] = useState<number | null>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CropResult | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    mode: CropDragMode;
    startX: number;
    startY: number;
    initialCrop: CropRect;
  } | null>(null);
  const loadSequenceRef = useRef(0);

  const job = useJob();
  const editorPreviewUrl = useObjectUrl(editorPreviewBlob);
  const coordinateId = useId();
  const bounds = decodedImg ? { width: decodedImg.width, height: decodedImg.height } : null;

  useEffect(
    () => () => {
      loadSequenceRef.current += 1;
      dragRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (job.status === 'done') setDecodedImg(null);
  }, [job.status]);

  const updateDisplaySize = useCallback(() => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      setDisplaySize((current) =>
        current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height },
      );
    }
  }, []);

  useEffect(() => {
    const image = imgRef.current;
    if (!image) return;
    updateDisplaySize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateDisplaySize);
      return () => window.removeEventListener('resize', updateDisplaySize);
    }
    const observer = new ResizeObserver(updateDisplaySize);
    observer.observe(image);
    return () => observer.disconnect();
  }, [decodedImg, editorPreviewUrl, updateDisplaySize]);

  const initCropForAspect = useCallback((imgW: number, imgH: number, ratio: number | null): CropRect => {
    let width = Math.round(imgW * 0.8);
    let height = Math.round(imgH * 0.8);
    if (ratio) {
      if (width / height > ratio) width = Math.round(height * ratio);
      else height = Math.round(width / ratio);
    }
    return clampCrop(
      {
        x: Math.round((imgW - width) / 2),
        y: Math.round((imgH - height) / 2),
        width,
        height,
      },
      { width: imgW, height: imgH },
    );
  }, []);

  const handleFiles = async (files: File[]) => {
    const selected = files[0];
    if (!selected) return;
    const sequence = ++loadSequenceRef.current;
    setFile(selected);
    setMetaError(null);
    setDecodedImg(null);
    setEditorPreviewBlob(null);
    setEditorPreviewError(false);
    setDisplaySize({ width: 0, height: 0 });
    setResultInfo(null);
    job.reset();

    try {
      const img = await decodeImage(selected);
      if (sequence !== loadSequenceRef.current) return;
      setDecodedImg(img);
      setCrop(initCropForAspect(img.width, img.height, aspect));
      try {
        const previewBlob = await createBoundedPngPreview(img, img.width, img.height, 1280);
        if (sequence === loadSequenceRef.current) setEditorPreviewBlob(previewBlob);
      } catch {
        // The crop selection remains available through numeric source-pixel controls if a preview cannot be encoded.
        if (sequence === loadSequenceRef.current) setEditorPreviewError(true);
      }
    } catch {
      if (sequence === loadSequenceRef.current) setMetaError(t('Could not decode image. The file may be corrupt or unsupported.'));
    }
  };

  const handleReset = () => {
    loadSequenceRef.current += 1;
    dragRef.current = null;
    setFile(null);
    setDecodedImg(null);
    setEditorPreviewBlob(null);
    setEditorPreviewError(false);
    setDisplaySize({ width: 0, height: 0 });
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const handleSelectAspect = (ratio: number | null) => {
    setAspect(ratio);
    if (decodedImg) setCrop(initCropForAspect(decodedImg.width, decodedImg.height, ratio));
  };

  const pointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const rect = imgRef.current?.getBoundingClientRect();
      if (!rect || !decodedImg || rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: Math.max(0, Math.min(decodedImg.width, ((clientX - rect.left) / rect.width) * decodedImg.width)),
        y: Math.max(0, Math.min(decodedImg.height, ((clientY - rect.top) / rect.height) * decodedImg.height)),
      };
    },
    [decodedImg],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!decodedImg || !bounds || job.status === 'running') return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    if (target.tabIndex >= 0) target.focus({ preventScroll: true });
    const mode = target.closest<HTMLElement>('[data-crop-mode]')?.dataset.cropMode as CropDragMode | undefined;
    const dragMode = mode || 'draw';
    dragRef.current = {
      pointerId: e.pointerId,
      mode: dragMode,
      startX: point.x,
      startY: point.y,
      initialCrop: { ...crop },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (dragMode === 'draw') {
      setCrop(createCropSelection(point, point, bounds, aspect));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !decodedImg || !bounds) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;

    if (drag.mode === 'draw') {
      setCrop(createCropSelection({ x: drag.startX, y: drag.startY }, point, bounds, aspect));
    } else if (drag.mode === 'move') {
      setCrop(moveCrop(drag.initialCrop, dx, dy, bounds));
    } else {
      setCrop(resizeCrop(drag.initialCrop, dx, dy, drag.mode, bounds, aspect));
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // The browser may already have released capture after cancellation.
    }
  };

  const onSelectionKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!bounds || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    setCrop((current) => moveCrop(current, dx, dy, bounds));
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, mode: Exclude<CropDragMode, 'draw' | 'move'>) => {
    if (!bounds || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    setCrop((current) => resizeCrop(current, dx, dy, mode, bounds, aspect));
  };

  const updateNumeric = (key: keyof CropRect, value: number) => {
    if (!bounds) return;
    setCrop((current) => updateCropValue(current, key, value, bounds, aspect));
  };

  const resetCrop = () => {
    if (decodedImg) setCrop(initCropForAspect(decodedImg.width, decodedImg.height, aspect));
  };

  const handleApplyCrop = () => {
    if (!file || !decodedImg || !bounds || crop.width <= 0 || crop.height <= 0) return;
    const outputCrop = clampCrop(crop, bounds);

    job.run(async (setProgress) => {
      setProgress(0.2);
      const canvas = document.createElement('canvas');
      canvas.width = outputCrop.width;
      canvas.height = outputCrop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(t('Canvas 2D unavailable'));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decodedImg, outputCrop.x, outputCrop.y, outputCrop.width, outputCrop.height, 0, 0, outputCrop.width, outputCrop.height);
      setProgress(0.6);

      const defaultFmt = getDefaultFormat(file, 'image/png');
      const mime: EncodableMime = defaultFmt.mime;
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? undefined : 0.92);
      setProgress(1);

      const info: CropResult = {
        blob,
        filename: formatOutputFile(file.name, '-cropped', ext),
        width: outputCrop.width,
        height: outputCrop.height,
      };
      setResultInfo(info);
      return blob;
    });
  };

  const scaleX = decodedImg && displaySize.width > 0 ? displaySize.width / decodedImg.width : 0;
  const scaleY = decodedImg && displaySize.height > 0 ? displaySize.height / decodedImg.height : 0;
  const boxStyle: React.CSSProperties = {
    left: `${crop.x * scaleX}px`,
    top: `${crop.y * scaleY}px`,
    width: `${crop.width * scaleX}px`,
    height: `${crop.height * scaleY}px`,
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-crop">
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
                  {t('Cropped dimensions')}:{' '}
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
                  <Field label={t('Aspect ratio')}>
                    <div className={basicStyles.presetChips}>
                      {PRESETS.map((preset) => {
                        const isActive = aspect === preset.ratio;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            className={`${basicStyles.presetChip} ${isActive ? basicStyles.presetChipActive : ''}`}
                            aria-pressed={isActive}
                            onClick={() => handleSelectAspect(preset.ratio)}
                          >
                            {t(preset.label)}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className={cropStyles.editorRow}>
                    {decodedImg && editorPreviewUrl ? (
                      <div
                        ref={stageRef}
                        className={cropStyles.cropWrapper}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={finishPointer}
                        onPointerCancel={finishPointer}
                        onLostPointerCapture={finishPointer}
                      >
                        <img
                          ref={imgRef}
                          src={editorPreviewUrl}
                          alt={t('Image crop editor')}
                          className={cropStyles.cropImage}
                          draggable={false}
                          onLoad={updateDisplaySize}
                        />
                        {scaleX > 0 && scaleY > 0 && (
                          <div className={cropStyles.cropBox} style={boxStyle} data-crop-mode="move">
                            <span className={cropStyles.ruleVerticalLeft} aria-hidden="true" />
                            <span className={cropStyles.ruleVerticalRight} aria-hidden="true" />
                            <span className={cropStyles.ruleHorizontalTop} aria-hidden="true" />
                            <span className={cropStyles.ruleHorizontalBottom} aria-hidden="true" />
                            <div
                              className={cropStyles.selectionKeyboardTarget}
                              role="group"
                              tabIndex={0}
                              aria-label={t('Crop selection. Use arrow keys to move it.')}
                              aria-describedby={`${coordinateId}-hint`}
                              onKeyDown={onSelectionKeyDown}
                            />
                            {HANDLES.map((handle) => (
                              <button
                                key={handle}
                                type="button"
                                className={`${cropStyles.handle} ${HANDLE_CLASSES[handle]}`}
                                data-crop-mode={handle}
                                aria-label={t(HANDLE_LABELS[handle])}
                                title={t(HANDLE_LABELS[handle])}
                                aria-describedby={`${coordinateId}-hint`}
                                onKeyDown={(e) => onHandleKeyDown(e, handle)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : editorPreviewError ? (
                      <div className={cropStyles.editorLoading} role="status">
                        {t('Image preview is unavailable. Use the source-pixel fields to set the crop.')}
                      </div>
                    ) : metaError ? null : (
                      <div className={cropStyles.editorLoading} role="status">
                        {t('Loading image…')}
                      </div>
                    )}
                  </div>
                  <p id={`${coordinateId}-hint`} className={cropStyles.editorHint}>
                    {t('Drag inside the crop to move it. Drag outside to draw a new selection. Use arrow keys to move or resize.')}
                  </p>
                  <p className={cropStyles.editorNote}>
                    {t('The selection uses source pixel coordinates; export crops from the original decoded image.')}
                  </p>

                  <Field label={t('Crop coordinates (source pixels)')}>
                    <div className={cropStyles.inputsGrid}>
                      {(
                        [
                          ['x', 'X (px)', 0, decodedImg?.width || 10000],
                          ['y', 'Y (px)', 0, decodedImg?.height || 10000],
                          ['width', 'Width (px)', 1, decodedImg?.width || 10000],
                          ['height', 'Height (px)', 1, decodedImg?.height || 10000],
                        ] as const
                      ).map(([key, label, min, max]) => (
                        <div key={key}>
                          <label className="field-label" htmlFor={`${coordinateId}-${key}`}>
                            {t(label)}
                          </label>
                          <input
                            id={`${coordinateId}-${key}`}
                            type="number"
                            min={min}
                            max={max}
                            value={Math.round(crop[key])}
                            onChange={(e) => updateNumeric(key, parseInt(e.target.value, 10) || (key === 'x' || key === 'y' ? 0 : 1))}
                            className={basicStyles.inputNumber}
                          />
                        </div>
                      ))}
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different image')}
                    </Button>
                    <Button variant="secondary" onClick={resetCrop} disabled={!decodedImg}>
                      {t('Reset crop')}
                    </Button>
                    <Button variant="primary" onClick={handleApplyCrop} disabled={!decodedImg}>
                      {t('Crop image')}
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
