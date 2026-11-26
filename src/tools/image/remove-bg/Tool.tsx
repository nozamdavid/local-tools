import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Slider, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { hexToRgb, rgbToHex, detectCornerColor } from '../_generate/color';
import { removeSolidBackground, applyAiMask } from '../_generate/canvas';
import { SegmentClient } from '../../_segment/segmentClient';
import { useI18n } from '../../../lib/i18n';
import styles from './Tool.module.css';

type Mode = 'solid' | 'ai';
type BgReplacement = 'transparent' | 'color' | 'blur';
type ViewMode = 'result' | 'compare' | 'original';

export default function RemoveBgTool() {
  const meta = getToolMeta('img-remove-bg');
  const { t } = useI18n();

  const [file, setFile] = useState<File | null>(null);
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [sourceData, setSourceData] = useState<ImageData | null>(null);

  // Settings
  const [mode, setMode] = useState<Mode>('solid');
  const [viewMode, setViewMode] = useState<ViewMode>('result');
  const [compareSplit, setCompareSplit] = useState<number>(50); // percentage

  // Solid Mode Settings
  const [bgColorHex, setBgColorHex] = useState<string>('#ffffff');
  const [tolerance, setTolerance] = useState<number>(18);
  const [softness, setSoftness] = useState<number>(3);
  const [contiguous, setContiguous] = useState<boolean>(true);
  const [despill, setDespill] = useState<boolean>(true);

  // AI Mode Settings
  const [aiThreshold, setAiThreshold] = useState<number>(128);
  const [aiFeather, setAiFeather] = useState<number>(2);
  const [aiMask, setAiMask] = useState<Uint8ClampedArray | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiProgress, setAiProgress] = useState<{ text: string; percent: number; modelPercent?: number } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Background Replacement Settings
  const [bgReplacement, setBgReplacement] = useState<BgReplacement>('transparent');
  const [customBgColor, setCustomBgColor] = useState<string>('#ffffff');

  const [exportFormat, setExportFormat] = useState<'png' | 'webp'>('png');
  const [isExporting, setIsExporting] = useState(false);

  const bgSelectId = useId();
  const segmentClientRef = useRef<SegmentClient | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compareCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cleanup segment client on unmount
  useEffect(() => {
    return () => {
      if (segmentClientRef.current) {
        segmentClientRef.current.terminate();
        segmentClientRef.current = null;
      }
    };
  }, []);

  // Handle file selection
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setAiMask(null);
    setAiError(null);

    try {
      const img = await decodeImage(selected);
      setSourceImg(img);

      // Extract raw image data
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setSourceData(imgData);

      // Auto detect corner color
      const detected = detectCornerColor(imgData.data, canvas.width, canvas.height);
      setBgColorHex(detected.hex);
    } catch (err: any) {
      console.error('Failed to load image:', err);
    }
  };

  // Run AI segmentation
  const runAiSegmentation = useCallback(async () => {
    if (!sourceData) return;
    setIsAiLoading(true);
    setAiError(null);
    setAiProgress({ text: 'Initializing AI background removal model…', percent: 10 });

    try {
      if (!segmentClientRef.current) {
        segmentClientRef.current = new SegmentClient();
      }

      await segmentClientRef.current.init((progress) => {
        if (progress.status === 'downloading') {
          const pct = progress.progress ? Math.round(progress.progress) : 30;
          setAiProgress({ text: 'Downloading model weights ({percent}%)…', percent: Math.min(80, 20 + pct * 0.6), modelPercent: pct });
        } else if (progress.status === 'ready') {
          setAiProgress({ text: 'Model ready. Detecting subject…', percent: 85 });
        }
      });

      setAiProgress({ text: 'Segmenting subject from background…', percent: 90 });
      const { mask } = await segmentClientRef.current.segmentFrame(sourceData.data, sourceData.width, sourceData.height);

      setAiMask(mask);
      setAiProgress(null);
    } catch (err: any) {
      console.error('AI segmentation failed:', err);
      setAiError('AI segmentation failed to run.');
    } finally {
      setIsAiLoading(false);
    }
  }, [sourceData, t]);

  // When switching to AI mode, run segmentation if not yet computed
  useEffect(() => {
    if (mode === 'ai' && sourceData && !aiMask && !isAiLoading && !aiError) {
      runAiSegmentation();
    }
  }, [mode, sourceData, aiMask, isAiLoading, aiError, runAiSegmentation]);

  // Render current result onto a target canvas
  const renderResultToCanvas = useCallback(
    (targetCanvas: HTMLCanvasElement) => {
      if (!sourceData || !sourceImg) return;

      const { width, height } = sourceData;
      targetCanvas.width = width;
      targetCanvas.height = height;
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      // 1. Compute processed RGBA data
      let processedData: Uint8ClampedArray;

      if (mode === 'solid') {
        const rgb = hexToRgb(bgColorHex);
        processedData = removeSolidBackground(sourceData.data, width, height, {
          targetColor: rgb,
          tolerance,
          softness,
          contiguous,
          despill,
        });
      } else {
        // AI mode
        if (aiMask) {
          processedData = applyAiMask(sourceData.data, aiMask, width, height, aiThreshold, aiFeather);
        } else {
          processedData = new Uint8ClampedArray(sourceData.data);
        }
      }

      // 2. Composite background
      ctx.clearRect(0, 0, width, height);

      if (bgReplacement === 'color') {
        ctx.fillStyle = customBgColor;
        ctx.fillRect(0, 0, width, height);
      } else if (bgReplacement === 'blur') {
        ctx.save();
        ctx.filter = 'blur(16px)';
        ctx.drawImage(sourceImg, -10, -10, width + 20, height + 20);
        ctx.restore();
      }

      // 3. Draw subject on top
      const subjectImgData = ctx.createImageData(width, height);
      subjectImgData.data.set(processedData);

      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.putImageData(subjectImgData, 0, 0);
        ctx.drawImage(offscreen, 0, 0);
      }
    },
    [
      sourceData,
      sourceImg,
      mode,
      bgColorHex,
      tolerance,
      softness,
      contiguous,
      despill,
      aiMask,
      aiThreshold,
      aiFeather,
      bgReplacement,
      customBgColor,
    ],
  );

  // Update preview canvas whenever dependencies change
  useEffect(() => {
    if (viewMode === 'result' && previewCanvasRef.current) {
      renderResultToCanvas(previewCanvasRef.current);
    } else if (viewMode === 'compare' && compareCanvasRef.current) {
      renderResultToCanvas(compareCanvasRef.current);
    }
  }, [renderResultToCanvas, viewMode]);

  // Click on image to pick background color (Eyedropper)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'solid' || !sourceData || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY)));

    const idx = (y * canvas.width + x) * 4;
    const r = sourceData.data[idx];
    const g = sourceData.data[idx + 1];
    const b = sourceData.data[idx + 2];
    setBgColorHex(rgbToHex(r, g, b));
  };

  // Re-detect corner color
  const handleAutoDetectColor = () => {
    if (!sourceData) return;
    const detected = detectCornerColor(sourceData.data, sourceData.width, sourceData.height);
    setBgColorHex(detected.hex);
  };

  const exportFilename = withSuffix(file?.name || 'image.png', '-nobg', exportFormat);
  const isWaitingForMask = mode === 'ai' && isAiLoading;

  const getExportBlob = async () => {
    setIsExporting(true);
    try {
      const exportCanvas = document.createElement('canvas');
      renderResultToCanvas(exportCanvas);
      return await canvasToBlob(exportCanvas, `image/${exportFormat}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownload = async () => {
    try {
      downloadBlob(await getExportBlob(), exportFilename);
    } catch (err) {
      console.error('Failed to download image:', err);
    }
  };

  const handleReset = () => {
    setFile(null);
    setSourceImg(null);
    setSourceData(null);
    setAiMask(null);
    setAiProgress(null);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-remove-bg">
      <div className={styles.container}>
        {!sourceData ? (
          <FileDrop
            accept={IMAGE_ACCEPT}
            label={t('Drop an image here to remove background')}
            hint={t('Supports JPG, PNG, WebP, SVG and HEIC.')}
            onFiles={handleFiles}
          />
        ) : (
          <div className={styles.layout}>
            {/* Sidebar Controls */}
            <div className={styles.panel}>
              {/* Mode Switcher */}
              <div className={styles.modeTabs}>
                <button
                  type="button"
                  className={`${styles.modeTab} ${mode === 'solid' ? styles.modeTabActive : ''}`}
                  onClick={() => setMode('solid')}
                >
                  {t('Solid colour')}
                </button>
                <button
                  type="button"
                  className={`${styles.modeTab} ${mode === 'ai' ? styles.modeTabActive : ''}`}
                  onClick={() => setMode('ai')}
                >
                  {t('AI subject detection')}
                </button>
              </div>

              {/* Solid Mode Controls */}
              {mode === 'solid' && (
                <>
                  <Field label={t('Background colour')} hint={t('Click anywhere on the preview image to pick a colour')}>
                    <div className={styles.colorPickerRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={bgColorHex}
                        onChange={(e) => setBgColorHex(e.target.value)}
                      />
                      <span>{bgColorHex}</span>
                      <Button variant="secondary" className={styles.smallBtn} onClick={handleAutoDetectColor}>
                        {t('Auto-detect')}
                      </Button>
                    </div>
                  </Field>

                  <Field label={t('Tolerance')}>
                    <Slider min={0} max={60} step={1} unit="%" value={tolerance} onChange={setTolerance} />
                  </Field>

                  <Field label={t('Edge softness')}>
                    <Slider min={0} max={20} step={1} unit="px" value={softness} onChange={setSoftness} />
                  </Field>

                  <div className={styles.twoCols}>
                    <label className={styles.checkboxLabel}>
                      <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
                      {t('Flood fill from edges')}
                    </label>

                    <label className={styles.checkboxLabel}>
                      <input type="checkbox" checked={despill} onChange={(e) => setDespill(e.target.checked)} />
                      {t('Edge despill')}
                    </label>
                  </div>
                </>
              )}

              {/* AI Mode Controls */}
              {mode === 'ai' && (
                <>
                  {isAiLoading && aiProgress && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <ProgressBar value={aiProgress.percent / 100} label={t(aiProgress.text, { percent: aiProgress.modelPercent ?? 0 })} />
                    </div>
                  )}

                  {aiError && (
                    <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>
                      {t(aiError)}
                      <Button variant="secondary" className={styles.smallBtn} style={{ marginTop: '0.5rem' }} onClick={runAiSegmentation}>
                        {t('Retry AI detection')}
                      </Button>
                    </div>
                  )}

                  {aiMask && (
                    <>
                      <Field label={t('Detection threshold')}>
                        <Slider min={20} max={240} step={2} value={aiThreshold} onChange={setAiThreshold} />
                      </Field>

                      <Field label={t('Edge feathering')}>
                        <Slider min={0} max={15} step={1} unit="px" value={aiFeather} onChange={setAiFeather} />
                      </Field>

                      <Button variant="secondary" className={styles.smallBtn} onClick={runAiSegmentation}>
                        {t('Re-run AI detection')}
                      </Button>
                    </>
                  )}
                </>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

              {/* Background Replacement Options */}
              <Field label={t('Background output')}>
                <Select
                  id={bgSelectId}
                  value={bgReplacement}
                  onChange={(e) => setBgReplacement(e.target.value as BgReplacement)}
                  options={[
                    { value: 'transparent', label: t('Transparent (none)') },
                    { value: 'color', label: t('Solid colour fill') },
                    { value: 'blur', label: t('Blurred original background') },
                  ]}
                />
              </Field>

              {bgReplacement === 'color' && (
                <Field label={t('Fill colour')}>
                  <div className={styles.colorPickerRow}>
                    <input
                      type="color"
                      className={styles.colorInput}
                      value={customBgColor}
                      onChange={(e) => setCustomBgColor(e.target.value)}
                    />
                    <span>{customBgColor}</span>
                  </div>
                </Field>
              )}

              <Button variant="secondary" onClick={handleReset}>
                {t('Choose different image')}
              </Button>
            </div>

            {/* Preview Column */}
            <div className={styles.previewCard}>
              <div className={styles.previewHeader}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {sourceData.width} × {sourceData.height} px
                </span>

                <div className={styles.viewToggle}>
                  <button
                    type="button"
                    className={`${styles.viewBtn} ${viewMode === 'result' ? styles.viewBtnActive : ''}`}
                    onClick={() => setViewMode('result')}
                  >
                    {t('Result')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.viewBtn} ${viewMode === 'compare' ? styles.viewBtnActive : ''}`}
                    onClick={() => setViewMode('compare')}
                  >
                    {t('Compare split')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.viewBtn} ${viewMode === 'original' ? styles.viewBtnActive : ''}`}
                    onClick={() => setViewMode('original')}
                  >
                    {t('Original')}
                  </button>
                </div>
              </div>

              <div className={styles.viewportWrapper}>
                {viewMode === 'result' && (
                  <canvas
                    ref={previewCanvasRef}
                    className={styles.canvas}
                    role="img"
                    aria-label={t('Result with the background removed. Use the colour field in the controls to choose a solid background.')}
                    onClick={handleCanvasClick}
                    title={mode === 'solid' ? t('Click to pick background colour') : undefined}
                    style={{ cursor: mode === 'solid' ? 'crosshair' : 'default' }}
                  />
                )}

                {viewMode === 'original' && sourceImg && <img src={sourceImg.src} alt={t('Original')} className={styles.canvas} />}

                {viewMode === 'compare' && sourceImg && (
                  <div
                    className={styles.compareContainer}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                      setCompareSplit(Math.round((x / rect.width) * 100));
                    }}
                  >
                    {/* Underlying Result Canvas */}
                    <canvas
                      ref={compareCanvasRef}
                      className={styles.canvas}
                      role="img"
                      aria-label={t(
                        'Before and after comparison. The divider follows the pointer; switch to Original or Result for keyboard use.',
                      )}
                    />

                    {/* Top Clipped Original Image */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: `${compareSplit}%`,
                        height: '100%',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={sourceImg.src}
                        alt={t('Original')}
                        style={{
                          width: `${(100 / compareSplit) * 100}%`,
                          height: '100%',
                          maxWidth: 'none',
                          objectFit: 'contain',
                        }}
                      />
                    </div>

                    {/* Slider separator bar */}
                    <div className={styles.compareSliderLine} style={{ left: `${compareSplit}%` }}>
                      <div className={styles.compareHandle}>⇄</div>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.actions}>
                <Field label={t('Output format')}>
                  <Select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value === 'webp' ? 'webp' : 'png')}
                    options={[
                      { value: 'png', label: t('PNG') },
                      { value: 'webp', label: t('WebP') },
                    ]}
                  />
                </Field>
                <div className={styles.actionButtons}>
                  <Button onClick={handleDownload} loading={isExporting} disabled={isWaitingForMask}>
                    {t('Download')}
                  </Button>
                  <CopyImageButton getImage={getExportBlob} disabled={isExporting || isWaitingForMask} filename={exportFilename} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
