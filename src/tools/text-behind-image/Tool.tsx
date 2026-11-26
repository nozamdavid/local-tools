import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { Field, Select, Slider, Button } from '../../components/Controls';
import { CopyImageButton } from '../../components/CopyImageButton';
import { getToolMeta } from '../registry';
import { formatBytes, withSuffix } from '../../lib/format';
import { downloadBlob } from '../../lib/download';
import { canvasToBlob } from '../../lib/image';
import { useI18n } from '../../lib/i18n';
import { SegmentClient } from '../_segment/segmentClient';
import { drawTextLayers, calculateTargetSize } from '../_segment/composite';
import { getSegmentErrorMessage } from '../_segment/errors';
import type { TextLayer } from '../_segment/types';
import styles from './Tool.module.css';

const SYSTEM_FONTS = [
  { value: 'Impact, sans-serif', label: 'Impact (Bold Poster)' },
  { value: 'Arial, sans-serif', label: 'Arial (Clean Sans)' },
  { value: 'Montserrat, sans-serif', label: 'Montserrat (Modern Sans)' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Georgia, serif', label: 'Georgia (Editorial Serif)' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Courier New, monospace', label: 'Courier New (Monospace)' },
];

const FONT_WEIGHTS = [
  { value: '400', label: 'Regular (400)' },
  { value: '600', label: 'Semi-Bold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '900', label: 'Black / Heavy (900)' },
];

export default function TextBehindImageTool() {
  const { t } = useI18n();
  const meta = getToolMeta('text-behind-image');
  const [file, setFile] = useState<File | null>(null);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);

  const [segmenting, setSegmenting] = useState<boolean>(false);
  const [segmentProgress, setSegmentProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<{ key: string; params?: Record<string, string | number> }>({
    key: 'Initializing AI subject segmentation...',
  });
  const [error, setError] = useState<string | null>(null);

  const [layers, setLayers] = useState<TextLayer[]>([
    {
      id: 'layer-1',
      text: 'BEHIND',
      fontFamily: 'Impact, sans-serif',
      fontSize: 84,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 4,
      opacity: 1,
      rotation: 0,
      x: 0.5,
      y: 0.38,
    },
  ]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>('layer-1');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const segmentClientRef = useRef<SegmentClient | null>(null);
  const imageRequest = useRef(0);

  useEffect(
    () => () => {
      imageRequest.current++;
      segmentClientRef.current?.terminate();
      segmentClientRef.current = null;
    },
    [],
  );

  const canvasHintId = useId();
  const fontId = useId();
  const weightId = useId();

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || layers[0];

  const updateSelectedLayer = (patch: Partial<TextLayer>) => {
    if (!selectedLayer) return;
    setLayers((prev) => prev.map((l) => (l.id === selectedLayer.id ? { ...l, ...patch } : l)));
  };

  const handleAddLayer = () => {
    const newId = `layer-${Date.now()}`;
    const newLayer: TextLayer = {
      id: newId,
      text: 'NEW TEXT',
      fontFamily: selectedLayer?.fontFamily || 'Impact, sans-serif',
      fontSize: selectedLayer?.fontSize || 72,
      fontWeight: selectedLayer?.fontWeight || '700',
      color: '#ffffff',
      letterSpacing: 2,
      opacity: 1,
      rotation: 0,
      x: 0.5,
      y: 0.65,
    };
    setLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newId);
  };

  const handleDeleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    const remaining = layers.filter((l) => l.id !== id);
    setLayers(remaining);
    setSelectedLayerId(remaining[0].id);
  };

  // Run segmentation once when an image file is selected
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const request = ++imageRequest.current;
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setFile(selected);
    setError(null);
    setImageEl(null);
    setSegmentProgress(0);
    maskCanvasRef.current = null;

    const img = new Image();
    const objectUrl = URL.createObjectURL(selected);
    let client: SegmentClient | undefined;

    try {
      try {
        img.src = objectUrl;
        await img.decode().catch(() => {
          throw new Error('Failed to load image file');
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      if (imageRequest.current !== request) return;

      setImageEl(img);
      setSegmenting(true);
      setSegmentProgress(0);
      setProgressMessage({ key: 'Initializing AI subject segmentation...' });

      client = new SegmentClient();
      segmentClientRef.current = client;

      await client.init((p) => {
        if (p?.progress !== undefined) {
          setSegmentProgress(Math.min(0.99, p.progress / 100));
          setProgressMessage({ key: 'Loading model: {percent}%', params: { percent: Math.round(p.progress) } });
        }
      });

      setProgressMessage({ key: 'Segmenting subject from image...' });
      setSegmentProgress(0.5);

      // Model input size
      const { width: segW, height: segH } = calculateTargetSize(img.naturalWidth, img.naturalHeight, '1080p');
      const scratch = document.createElement('canvas');
      scratch.width = segW;
      scratch.height = segH;
      const sCtx = scratch.getContext('2d', { willReadFrequently: true });
      if (!sCtx) throw new Error('Could not create canvas context');

      sCtx.drawImage(img, 0, 0, segW, segH);
      const frameData = sCtx.getImageData(0, 0, segW, segH);

      const { mask } = await client.segmentFrame(frameData.data, segW, segH);
      if (imageRequest.current !== request) return;

      // Store mask in offscreen canvas with alpha channel
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = segW;
      maskCanvas.height = segH;
      const mCtx = maskCanvas.getContext('2d');
      if (!mCtx) throw new Error('Could not create mask context');

      const maskImgData = mCtx.createImageData(segW, segH);
      const mData = maskImgData.data;
      for (let i = 0; i < segW * segH; i++) {
        mData[i * 4] = 255;
        mData[i * 4 + 1] = 255;
        mData[i * 4 + 2] = 255;
        mData[i * 4 + 3] = mask[i];
      }
      mCtx.putImageData(maskImgData, 0, 0);
      maskCanvasRef.current = maskCanvas;

      setSegmenting(false);
      setSegmentProgress(1);
    } catch (err) {
      if (imageRequest.current !== request) return;
      setError(getSegmentErrorMessage(err) || 'Failed to segment image.');
      setSegmenting(false);
    } finally {
      client?.terminate();
      if (segmentClientRef.current === client) segmentClientRef.current = null;
    }
  };

  // Render preview canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageEl;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !img || !maskCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Display preview resolution capped to 1000px
    const maxPreview = 1000;
    const scale = Math.min(1, maxPreview / Math.max(img.naturalWidth, img.naturalHeight));
    const previewW = Math.round(img.naturalWidth * scale);
    const previewH = Math.round(img.naturalHeight * scale);

    if (canvas.width !== previewW || canvas.height !== previewH) {
      canvas.width = previewW;
      canvas.height = previewH;
    }

    ctx.clearRect(0, 0, previewW, previewH);

    // 1. Draw background image
    ctx.drawImage(img, 0, 0, previewW, previewH);

    // 2. Draw text layers behind subject
    drawTextLayers(ctx, layers, previewW, previewH, scale);

    // 3. Draw subject on top
    const subjectCanvas = document.createElement('canvas');
    subjectCanvas.width = previewW;
    subjectCanvas.height = previewH;
    const subCtx = subjectCanvas.getContext('2d');
    if (subCtx) {
      subCtx.drawImage(img, 0, 0, previewW, previewH);
      subCtx.globalCompositeOperation = 'destination-in';
      subCtx.drawImage(maskCanvas, 0, 0, previewW, previewH);
      subCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(subjectCanvas, 0, 0);
    }
  }, [imageEl, layers]);

  useEffect(() => {
    if (!segmenting && maskCanvasRef.current) {
      renderCanvas();
    }
  }, [segmenting, renderCanvas]);

  // Pointer drag handling on canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selectedLayer || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    updateLayerPosFromPointer(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    updateLayerPosFromPointer(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const updateLayerPosFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedLayer) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    updateSelectedLayer({ x, y });
  };

  // Keyboard equivalent of dragging: arrow keys nudge the selected layer by 1% of the image (5% with Shift).
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!selectedLayer) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    updateSelectedLayer({
      x: Math.max(0, Math.min(1, selectedLayer.x + dx)),
      y: Math.max(0, Math.min(1, selectedLayer.y + dy)),
    });
  };

  // Full-resolution export
  const getExportImage = () => {
    const img = imageEl;
    const maskCanvas = maskCanvasRef.current;
    if (!img || !maskCanvas) throw new Error('Export failed.');

    const fullW = img.naturalWidth;
    const fullH = img.naturalHeight;

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = fullW;
    fullCanvas.height = fullH;
    const ctx = fullCanvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');

    // 1. Draw full-res background
    ctx.drawImage(img, 0, 0, fullW, fullH);

    // 2. Draw text layers scaled to full resolution
    const previewScale = Math.min(1, 1000 / Math.max(fullW, fullH));
    const basePreviewW = fullW * previewScale;
    const fullScale = fullW / basePreviewW;
    drawTextLayers(ctx, layers, fullW, fullH, fullScale);

    // 3. Draw full-res subject
    const subjectCanvas = document.createElement('canvas');
    subjectCanvas.width = fullW;
    subjectCanvas.height = fullH;
    const subCtx = subjectCanvas.getContext('2d');
    if (subCtx) {
      subCtx.drawImage(img, 0, 0, fullW, fullH);
      subCtx.globalCompositeOperation = 'destination-in';
      subCtx.drawImage(maskCanvas, 0, 0, fullW, fullH);
      subCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(subjectCanvas, 0, 0);
    }

    return canvasToBlob(fullCanvas, 'image/png');
  };

  const outputFilename = file ? withSuffix(file.name, '-text-behind', 'png') : '';
  const canExport = imageEl !== null && segmentProgress === 1;

  const handleDownload = async () => {
    if (!canExport) return;
    try {
      downloadBlob(await getExportImage(), outputFilename);
    } catch {
      setError('Export failed.');
    }
  };

  const handleReset = () => {
    imageRequest.current++;
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setFile(null);
    setImageEl(null);
    setSegmenting(false);
    setSegmentProgress(0);
    maskCanvasRef.current = null;
    setError(null);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="text-behind-image">
      {!file ? (
        <FileDrop
          accept="image/*"
          label={t('Choose an image or drag it here')}
          hint={t('Place beautiful typography behind portrait subjects in 100% private browser processing.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {error && <div className="error-banner">{t(error)}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              {t('Name:')} <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              {t('Size:')} <strong>{formatBytes(file.size)}</strong>
            </span>
            {imageEl && (
              <span className="meta-chip">
                {t('Resolution:')}{' '}
                <strong>
                  {imageEl.naturalWidth}x{imageEl.naturalHeight}
                </strong>
              </span>
            )}
          </div>

          {segmenting ? (
            <div style={{ marginTop: '2rem' }}>
              <ProgressBar value={segmentProgress} label={t(progressMessage.key, progressMessage.params)} />
            </div>
          ) : (
            <div className={styles.editorLayout}>
              {/* Left / Top: Interactive Canvas Preview */}
              <div className={styles.canvasWrapper}>
                <div className={styles.canvasHint} id={canvasHintId}>
                  {t(
                    'Click & drag anywhere on the image to position the selected text. With the preview focused, use the arrow keys to move it (Shift for larger steps).',
                  )}
                </div>
                <canvas
                  ref={canvasRef}
                  className={styles.canvas}
                  tabIndex={0}
                  role="img"
                  aria-label={t('Image preview with the selected text layer placed behind the subject')}
                  aria-describedby={canvasHintId}
                  onKeyDown={handleCanvasKeyDown}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />

                <div className="action-buttons" style={{ marginTop: '1.5rem', width: '100%' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Choose another image')}
                  </Button>
                  {canExport && imageEl && (
                    <span className="meta-chip" style={{ alignSelf: 'center' }}>
                      PNG · {imageEl.naturalWidth} × {imageEl.naturalHeight}
                    </span>
                  )}
                  <CopyImageButton getImage={getExportImage} disabled={!canExport} filename={outputFilename} />
                  <Button variant="primary" onClick={handleDownload} disabled={!canExport} aria-label={t('Download PNG (Full Resolution)')}>
                    {t('Download')}
                  </Button>
                </div>
              </div>

              {/* Right / Bottom: Layer Controls */}
              {selectedLayer && (
                <div className={styles.controlsPanel}>
                  <div>
                    <div className={styles.layersHeader}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('Text Layers')}</span>
                      <Button variant="secondary" onClick={handleAddLayer} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                        {t('+ Add Layer')}
                      </Button>
                    </div>
                    <div className={styles.layersTabs}>
                      {layers.map((l, index) => (
                        <button
                          key={l.id}
                          className={`${styles.layerTab} ${l.id === selectedLayer.id ? styles.layerTabActive : ''}`}
                          onClick={() => setSelectedLayerId(l.id)}
                        >
                          {t('Layer {number}: {text}', { number: index + 1, text: l.text || t('(empty)') })}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field label={t('Text content')}>
                    <input
                      type="text"
                      className="select"
                      style={{ padding: '8px 12px' }}
                      value={selectedLayer.text}
                      onChange={(e) => updateSelectedLayer({ text: e.target.value })}
                      placeholder={t('Enter text...')}
                    />
                  </Field>

                  <Field label={t('Font family')}>
                    <Select
                      id={fontId}
                      value={selectedLayer.fontFamily}
                      onChange={(e) => updateSelectedLayer({ fontFamily: e.target.value })}
                      options={SYSTEM_FONTS.map(({ value, label }) => ({ value, label: t(label) }))}
                    />
                  </Field>

                  <div className={styles.rowInputs}>
                    <Field label={t('Font weight')}>
                      <Select
                        id={weightId}
                        value={selectedLayer.fontWeight}
                        onChange={(e) => updateSelectedLayer({ fontWeight: e.target.value })}
                        options={FONT_WEIGHTS.map(({ value, label }) => ({ value, label: t(label) }))}
                      />
                    </Field>

                    <Field label={t('Color')}>
                      <div className={styles.colorPickerRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedLayer.color}
                          onChange={(e) => updateSelectedLayer({ color: e.target.value })}
                        />
                        <input
                          type="text"
                          className={styles.hexInput}
                          value={selectedLayer.color}
                          onChange={(e) => updateSelectedLayer({ color: e.target.value })}
                        />
                      </div>
                    </Field>
                  </div>

                  <Field label={t('Font size')}>
                    <Slider
                      value={selectedLayer.fontSize}
                      min={12}
                      max={300}
                      step={2}
                      unit="px"
                      onChange={(val) => updateSelectedLayer({ fontSize: val })}
                    />
                  </Field>

                  <Field label={t('Letter spacing')}>
                    <Slider
                      value={selectedLayer.letterSpacing}
                      min={-5}
                      max={40}
                      step={1}
                      unit="px"
                      onChange={(val) => updateSelectedLayer({ letterSpacing: val })}
                    />
                  </Field>

                  <Field label={t('Opacity')}>
                    <Slider
                      value={Math.round(selectedLayer.opacity * 100)}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      onChange={(val) => updateSelectedLayer({ opacity: val / 100 })}
                    />
                  </Field>

                  <Field label={t('Rotation')}>
                    <Slider
                      value={selectedLayer.rotation}
                      min={-180}
                      max={180}
                      step={1}
                      unit="°"
                      onChange={(val) => updateSelectedLayer({ rotation: val })}
                    />
                  </Field>

                  {layers.length > 1 && (
                    <button className={styles.deleteLayerBtn} onClick={() => handleDeleteLayer(selectedLayer.id)}>
                      {t('Delete this layer')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
