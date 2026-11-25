import { useEffect, useRef, useState, useId } from 'react';
import type { FrameConfig, FitMode, BgType, TransformState, ExportMime, SafeZoneGuide } from './types';
import { renderFrameCanvas } from './renderSocialCanvas';
import { decodeImage, canvasToBlob, type EncodableMime } from '../../../lib/image';
import { withSuffix, formatBytes } from '../../../lib/format';
import { Field, Slider, Select, Button } from '../../../components/Controls';
import { ResultPanel } from '../../../components/ResultPanel';
import { useI18n } from '../../../lib/i18n';
import styles from './FitToFrameEditor.module.css';

export interface FitToFrameEditorProps {
  config: FrameConfig;
  file: File;
  onReset: () => void;
  additionalInfo?: React.ReactNode;
}

export function FitToFrameEditor({ config, file, onReset, additionalInfo }: FitToFrameEditorProps) {
  const { t } = useI18n();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fitMode, setFitMode] = useState<FitMode>('cover');
  const [bgType, setBgType] = useState<BgType>('blur');
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [transform, setTransform] = useState<TransformState>({ zoom: 1.0, panX: 0, panY: 0 });
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [circularExport, setCircularExport] = useState<boolean>(false);

  const [exportFormat, setExportFormat] = useState<ExportMime>('image/jpeg');
  const [jpegQuality, setJpegQuality] = useState<number>(0.92);

  const [exporting, setExporting] = useState<boolean>(false);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);
  const [fileSizeWarning, setFileSizeWarning] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number }>({
    clientX: 0,
    clientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const formatSelectId = useId();

  // Load image
  useEffect(() => {
    let active = true;
    decodeImage(file)
      .then((loaded) => {
        if (!active) return;
        setImg(loaded);
        setLoadError(null);
        setTransform({ zoom: 1.0, panX: 0, panY: 0 });
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to decode image');
      });
    return () => {
      active = false;
    };
  }, [file]);

  // Render preview canvas
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = config.width;
    canvas.height = config.height;

    const rendered = renderFrameCanvas(img, {
      width: config.width,
      height: config.height,
      fitMode,
      bgType,
      bgColor,
      transform,
      circularClip: circularExport || config.isCirclePreview,
    });

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, config.width, config.height);
      ctx.drawImage(rendered, 0, 0);
    }
  }, [img, config, fitMode, bgType, bgColor, transform, circularExport]);

  // Pointer interactions for dragging / panning
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPanX: transform.panX,
      startPanY: transform.panY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scaleFactorX = config.width / rect.width;
    const scaleFactorY = config.height / rect.height;

    const deltaX = (e.clientX - dragStartRef.current.clientX) * scaleFactorX;
    const deltaY = (e.clientY - dragStartRef.current.clientY) * scaleFactorY;

    setTransform((prev) => ({
      ...prev,
      panX: Math.round(dragStartRef.current.startPanX + deltaX),
      panY: Math.round(dragStartRef.current.startPanY + deltaY),
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored if capture already lost
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setTransform((prev) => ({
      ...prev,
      zoom: Math.min(4.0, Math.max(0.2, Number((prev.zoom + delta).toFixed(2)))),
    }));
  };

  // Keyboard equivalent of drag and wheel: arrows pan (Shift for larger steps), + and - zoom.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    const dz = e.key === '+' || e.key === '=' ? 0.05 : e.key === '-' ? -0.05 : 0;
    if (!dx && !dy && !dz) return;
    e.preventDefault();
    setTransform((prev) => ({
      panX: prev.panX + dx,
      panY: prev.panY + dy,
      zoom: Math.min(4.0, Math.max(0.2, Number((prev.zoom + dz).toFixed(2)))),
    }));
  };

  const handleResetPanZoom = () => {
    setTransform({ zoom: 1.0, panX: 0, panY: 0 });
  };

  const handleExport = async (qualityOverride?: number) => {
    if (!img) return;
    setExporting(true);
    setFileSizeWarning(null);

    try {
      const isPng = exportFormat === 'image/png' || circularExport;
      const targetMime: EncodableMime = isPng ? 'image/png' : 'image/jpeg';
      const effQuality = qualityOverride ?? jpegQuality;

      const fullCanvas = renderFrameCanvas(img, {
        width: config.width,
        height: config.height,
        fitMode,
        bgType,
        bgColor,
        transform,
        circularClip: circularExport,
      });

      const blob = await canvasToBlob(fullCanvas, targetMime, isPng ? undefined : effQuality);

      const ext = isPng ? 'png' : 'jpg';
      const outputFilename = withSuffix(file.name, `-${config.width}x${config.height}`, ext);

      if (config.warnIfOverBytes && blob.size > config.warnIfOverBytes) {
        setFileSizeWarning(
          t('Output file is {size}, exceeding the recommended {limit} limit for this platform.', {
            size: formatBytes(blob.size),
            limit: formatBytes(config.warnIfOverBytes),
          }),
        );
      }

      setResult({ blob, filename: outputFilename });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loadError) {
    return (
      <div>
        <div className="error-banner">{t(loadError)}</div>
        <div style={{ marginTop: '1rem' }}>
          <Button variant="secondary" onClick={onReset}>
            {t('Choose different image')}
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <ResultPanel
        blob={result.blob}
        filename={result.filename}
        kind="image"
        originalSize={file.size}
        onReset={() => {
          setResult(null);
          setFileSizeWarning(null);
        }}
      >
        {fileSizeWarning && (
          <div className={styles.warningBox} style={{ margin: '1rem 0' }}>
            <span>⚠️ {fileSizeWarning}</span>
            <Button variant="secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }} onClick={() => handleExport(0.8)}>
              {t('Re-export at 80% quality')}
            </Button>
          </div>
        )}
      </ResultPanel>
    );
  }

  const renderGuide = (guide: SafeZoneGuide, idx: number) => {
    if (guide.type === 'top') {
      const topPercent = (guide.size / config.height) * 100;
      return (
        <div key={idx} className={`${styles.guideEdge} ${styles.guideTop}`} style={{ height: `${topPercent}%` }}>
          {t(guide.label)}
        </div>
      );
    }
    if (guide.type === 'bottom') {
      const bottomPercent = (guide.size / config.height) * 100;
      return (
        <div key={idx} className={`${styles.guideEdge} ${styles.guideBottom}`} style={{ height: `${bottomPercent}%` }}>
          {t(guide.label)}
        </div>
      );
    }
    if (guide.type === 'box') {
      const left = (guide.x / config.width) * 100;
      const top = (guide.y / config.height) * 100;
      const w = (guide.width / config.width) * 100;
      const h = (guide.height / config.height) * 100;
      return (
        <div key={idx} className={styles.guideBox} style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}>
          {t(guide.label)}
        </div>
      );
    }
    if (guide.type === 'circle') {
      const left = ((guide.cx - guide.radius) / config.width) * 100;
      const top = ((guide.cy - guide.radius) / config.height) * 100;
      const diameterX = ((guide.radius * 2) / config.width) * 100;
      const diameterY = ((guide.radius * 2) / config.height) * 100;
      return (
        <div
          key={idx}
          className={styles.guideCircle}
          style={{ left: `${left}%`, top: `${top}%`, width: `${diameterX}%`, height: `${diameterY}%` }}
        >
          {t(guide.label)}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={styles.editorWrapper}>
      <div className="meta-chips">
        <span className="meta-chip">
          {t('Target')}:{' '}
          <strong>
            {config.width} × {config.height} px
          </strong>
        </span>
        <span className="meta-chip">
          {t('Original')}: <strong>{img ? `${img.naturalWidth || img.width} × ${img.naturalHeight || img.height} px` : '...'}</strong>
        </span>
      </div>

      {additionalInfo}

      {/* Interactive canvas preview */}
      <div className={styles.canvasContainer}>
        <div
          className={`${styles.canvasInner} ${config.isCirclePreview && !circularExport ? styles.isCircle : ''}`}
          style={{ aspectRatio: `${config.width} / ${config.height}` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="group"
          aria-label={t('Image position. Arrow keys move the image (Shift for larger steps), plus and minus zoom.')}
          title={t('Drag to reposition, mouse wheel to zoom')}
        >
          <canvas ref={canvasRef} className={styles.previewCanvas} role="img" aria-label={t('Preview of the framed image')} />
          {showGuides && config.guides && config.guides.length > 0 && (
            <div className={styles.guidesOverlay}>{config.guides.map((g, i) => renderGuide(g, i))}</div>
          )}
        </div>
      </div>

      {/* Editor Controls */}
      <div className={styles.controlsGrid}>
        <Field label={t('Fit mode')} hint={t('Cover fills entire canvas; contain shows entire image.')}>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${fitMode === 'cover' ? styles.toggleBtnActive : ''}`}
              aria-pressed={fitMode === 'cover'}
              onClick={() => setFitMode('cover')}
            >
              {t('Cover')}
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${fitMode === 'contain' ? styles.toggleBtnActive : ''}`}
              aria-pressed={fitMode === 'contain'}
              onClick={() => setFitMode('contain')}
            >
              {t('Contain')}
            </button>
          </div>
        </Field>

        {fitMode === 'contain' && (
          <Field label={t('Contain background')} hint={t('Background for unfilled edges.')}>
            <div className={styles.buttonGroup}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${bgType === 'blur' ? styles.toggleBtnActive : ''}`}
                aria-pressed={bgType === 'blur'}
                onClick={() => setBgType('blur')}
              >
                {t('Blurred image')}
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${bgType === 'color' ? styles.toggleBtnActive : ''}`}
                aria-pressed={bgType === 'color'}
                onClick={() => setBgType('color')}
              >
                {t('Solid color')}
              </button>
            </div>
            {bgType === 'color' && (
              <div className={styles.colorInputRow} style={{ marginTop: '0.5rem' }}>
                <input type="color" className={styles.colorPicker} value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                <span style={{ fontSize: '0.85rem' }}>{bgColor}</span>
              </div>
            )}
          </Field>
        )}

        <Field label={t('Zoom')} hint={t('Drag image directly to pan; use slider or wheel to zoom.')}>
          <Slider
            value={transform.zoom}
            min={0.5}
            max={3.0}
            step={0.05}
            unit="x"
            onChange={(z) => setTransform((prev) => ({ ...prev, zoom: z }))}
          />
          <div style={{ marginTop: '0.5rem' }}>
            <Button type="button" variant="secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={handleResetPanZoom}>
              {t('Reset pan & zoom')}
            </Button>
          </div>
        </Field>
      </div>

      {config.allowCircularExport && (
        <label className="checkbox-label">
          <input type="checkbox" checked={circularExport} onChange={(e) => setCircularExport(e.target.checked)} />
          <span>{t('Export as circular PNG (transparent outer background)')}</span>
        </label>
      )}

      <details className="tool-options">
        <summary>{t('Export options')}</summary>
        <div className="tool-options-body">
          <div className={styles.controlsGrid}>
            <Field label={t('Export format')} hint={circularExport ? t('Circular exports use PNG.') : undefined}>
              <Select
                id={formatSelectId}
                value={circularExport ? 'image/png' : exportFormat}
                disabled={circularExport}
                onChange={(e) => setExportFormat(e.target.value as ExportMime)}
                options={[
                  { value: 'image/jpeg', label: t('JPEG') },
                  { value: 'image/png', label: t('PNG (lossless)') },
                ]}
              />
            </Field>

            {exportFormat === 'image/jpeg' && !circularExport && (
              <Field label={t('JPEG quality')}>
                <Select
                  value={String(jpegQuality)}
                  onChange={(e) => setJpegQuality(parseFloat(e.target.value))}
                  options={[
                    { value: '0.92', label: t('92% (recommended)') },
                    { value: '0.85', label: t('85% (balanced)') },
                    { value: '0.75', label: t('75% (smaller file)') },
                  ]}
                />
              </Field>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '0.5rem' }}>
            {config.guides && config.guides.length > 0 && (
              <label className="checkbox-label">
                <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                <span>{t('Show safe-zone guide overlays')}</span>
              </label>
            )}
          </div>
        </div>
      </details>

      <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
        <Button variant="secondary" onClick={onReset}>
          {t('Choose different photo')}
        </Button>
        <Button variant="primary" onClick={() => handleExport()} disabled={exporting}>
          {exporting ? t('Exporting…') : t('Export {width}×{height} image', { width: config.width, height: config.height })}
        </Button>
      </div>
    </div>
  );
}
