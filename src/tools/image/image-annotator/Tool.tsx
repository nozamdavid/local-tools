import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { CanvasDocument, ArrowLayer, RectLayer, EllipseLayer, LineLayer, BadgeLayer, CalloutLayer, RedactLayer } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage, StageMode, DrawConfig, ShapeConfig } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import { useI18n } from '../../../lib/i18n';
import styles from './Tool.module.css';

const COLOR_PRESETS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' },
];

type AnnotatorTool = 'select' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'badge' | 'callout' | 'highlighter' | 'redact';

export default function Tool() {
  const meta = getToolMeta('img-image-annotator');
  const { t } = useI18n();

  const [file, setFile] = useState<File | null>(null);
  const [activeTool, setActiveTool] = useState<AnnotatorTool>('select');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Common annotation styles
  const [color, setColor] = useState<string>('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [redactType, setRedactType] = useState<'blur' | 'pixelate'>('blur');
  const [stepBadgeNumber, setStepBadgeNumber] = useState<number>(1);

  // Export state
  const [exportMime, setExportMime] = useState<EncodableMime>('image/png');
  const [quality, setQuality] = useState<number>(92);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Canvas history
  const {
    document: doc,
    canUndo,
    canRedo,
    undo,
    redo,
    pushDoc,
    updateDocSilent,
    resetHistory,
  } = useCanvasHistory({
    width: 800,
    height: 600,
    baseImage: null,
    layers: [],
  });

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    try {
      const img = await decodeImage(f);
      setFile(f);
      const newDoc: CanvasDocument = {
        width: img.width,
        height: img.height,
        baseImage: img,
        layers: [],
      };
      resetHistory(newDoc);
      setSelectedLayerId(null);
      setStepBadgeNumber(1);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Failed to decode image.'));
    }
  };

  // Add specific layer directly
  const addArrow = () => {
    const newId = 'arrow-' + Date.now();
    const len = Math.max(80, Math.round(doc.width / 5));
    const newLayer: ArrowLayer = {
      id: newId,
      type: 'arrow',
      x: Math.max(10, Math.round(doc.width / 2 - len / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - 12)),
      width: len,
      height: 24,
      stroke: color,
      strokeWidth,
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addRect = () => {
    const newId = 'rect-' + Date.now();
    const w = Math.max(100, Math.round(doc.width / 4));
    const h = Math.max(80, Math.round(doc.height / 4));
    const newLayer: RectLayer = {
      id: newId,
      type: 'rect',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      stroke: color,
      strokeWidth,
      fill: 'transparent',
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addEllipse = () => {
    const newId = 'ellipse-' + Date.now();
    const w = Math.max(100, Math.round(doc.width / 4));
    const h = Math.max(80, Math.round(doc.height / 4));
    const newLayer: EllipseLayer = {
      id: newId,
      type: 'ellipse',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      stroke: color,
      strokeWidth,
      fill: 'transparent',
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addLine = () => {
    const newId = 'line-' + Date.now();
    const len = Math.max(80, Math.round(doc.width / 4));
    const newLayer: LineLayer = {
      id: newId,
      type: 'line',
      x: Math.max(10, Math.round(doc.width / 2 - len / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - 10)),
      width: len,
      height: 20,
      stroke: color,
      strokeWidth,
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addStepBadge = () => {
    const newId = 'badge-' + Date.now();
    const size = Math.max(36, Math.round(doc.width / 20));
    const newLayer: BadgeLayer = {
      id: newId,
      type: 'badge',
      number: stepBadgeNumber,
      x: Math.max(10, Math.round(doc.width / 2 - size / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - size / 2)),
      width: size,
      height: size,
      fill: color,
      textColor: color === '#ffffff' ? '#000000' : '#ffffff',
    };
    setStepBadgeNumber((prev) => prev + 1);
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addCallout = () => {
    const newId = 'callout-' + Date.now();
    const w = 180;
    const h = 70;
    const newLayer: CalloutLayer = {
      id: newId,
      type: 'callout',
      text: 'Note here',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      fill: color,
      textColor: color === '#ffffff' ? '#000000' : '#ffffff',
      fontSize: 16,
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const addRedactBox = () => {
    const newId = 'redact-' + Date.now();
    const w = Math.max(120, Math.round(doc.width / 4));
    const h = Math.max(60, Math.round(doc.height / 8));
    const newLayer: RedactLayer = {
      id: newId,
      type: 'redact',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      redactType,
    };
    pushDoc({ ...doc, layers: [...doc.layers, newLayer] });
    setSelectedLayerId(newId);
    setActiveTool('select');
  };

  const deleteLayer = (id: string) => {
    pushDoc({
      ...doc,
      layers: doc.layers.filter((l) => l.id !== id),
    });
    if (selectedLayerId === id) {
      setSelectedLayerId(null);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportDocument(doc, exportMime, quality / 100);
      const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
      const outName = withSuffix(file ? file.name : 'annotated-image.png', '-annotated', ext);
      downloadBlob(blob, outName);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Export failed.'));
    } finally {
      setIsExporting(false);
    }
  };

  // Determine stage mode and configs
  let stageMode: StageMode = 'select';
  let drawConfig: DrawConfig | undefined;
  const shapeConfig: ShapeConfig | undefined = undefined;

  if (activeTool === 'highlighter') {
    stageMode = 'draw';
    drawConfig = {
      stroke: color,
      strokeWidth: strokeWidth * 4,
      isHighlighter: true,
    };
  }

  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-image-annotator">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or screenshot to annotate')}
          hint={t('Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC and SVG.')}
          onFiles={handleFileDrop}
        />
      ) : (
        <div className={styles.container}>
          {/* Top Bar with History & Actions */}
          <div className={styles.topBar}>
            <div className={styles.historyGroup}>
              <button
                type="button"
                className={styles.iconBtn}
                title={t('Undo (Ctrl+Z)')}
                aria-label={t('Undo')}
                data-testid="undo-btn"
                disabled={!canUndo}
                onClick={undo}
              >
                ↩
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                title={t('Redo (Ctrl+Shift+Z)')}
                aria-label={t('Redo')}
                data-testid="redo-btn"
                disabled={!canRedo}
                onClick={redo}
              >
                ↪
              </button>
              {selectedLayerId && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={t('Delete layer (Del)')}
                  aria-label={t('Delete layer')}
                  onClick={() => deleteLayer(selectedLayerId)}
                  style={{ color: 'var(--danger)' }}
                >
                  🗑
                </button>
              )}
            </div>

            <Button variant="secondary" onClick={() => setFile(null)}>
              {t('Change image')}
            </Button>
          </div>

          {/* Annotator Tools Bar */}
          <div className={styles.toolbar}>
            <button
              type="button"
              className={`${styles.toolBtn} ${activeTool === 'select' ? styles.toolBtnActive : ''}`}
              onClick={() => setActiveTool('select')}
            >
              {t('↖ Select')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addArrow}>
              {t('➔ Arrow')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addRect}>
              {t('▭ Rectangle')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addEllipse}>
              {t('⬭ Ellipse')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addLine}>
              {t('― Line')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addStepBadge}>
              {t('① Step badge ({number})', { number: stepBadgeNumber })}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addCallout}>
              {t('💬 Callout')}
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${activeTool === 'highlighter' ? styles.toolBtnActive : ''}`}
              onClick={() => setActiveTool(activeTool === 'highlighter' ? 'select' : 'highlighter')}
            >
              {t('🖍 Highlighter')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={addRedactBox}>
              {t('🔒 Redact (blur / pixelate)')}
            </button>
          </div>

          {/* Interactive Canvas */}
          <CanvasStage
            document={doc}
            selectedLayerId={selectedLayerId}
            mode={stageMode}
            drawConfig={drawConfig}
            shapeConfig={shapeConfig}
            onSelectLayer={setSelectedLayerId}
            onUpdateDocSilent={updateDocSilent}
            onPushDoc={pushDoc}
            onDeleteLayer={deleteLayer}
          />

          {/* Settings Panel */}
          <div className={styles.settingsPanel}>
            <div className={styles.grid}>
              <Field label={t('Colour presets')}>
                <div className={styles.colorPresetsRow}>
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.hex}
                      type="button"
                      title={t(p.name)}
                      aria-label={t(p.name)}
                      className={`${styles.colorSwatch} ${color === p.hex ? styles.colorSwatchActive : ''}`}
                      style={{ backgroundColor: p.hex }}
                      onClick={() => {
                        setColor(p.hex);
                        if (selectedLayerId) {
                          pushDoc({
                            ...doc,
                            layers: doc.layers.map((l) => {
                              if (l.id !== selectedLayerId) return l;
                              if (l.type === 'badge' || l.type === 'callout') {
                                return {
                                  ...l,
                                  fill: p.hex,
                                  textColor: p.hex === '#ffffff' ? '#000000' : '#ffffff',
                                };
                              }
                              if ('stroke' in l) {
                                return { ...l, stroke: p.hex };
                              }
                              return l;
                            }),
                          });
                        }
                      }}
                    />
                  ))}
                </div>
              </Field>

              <Field label={t('Stroke width')}>
                <Slider
                  value={strokeWidth}
                  min={2}
                  max={24}
                  unit="px"
                  onChange={(v) => {
                    setStrokeWidth(v);
                    if (selectedLayerId) {
                      pushDoc({
                        ...doc,
                        layers: doc.layers.map((l) => (l.id === selectedLayerId && 'strokeWidth' in l ? { ...l, strokeWidth: v } : l)),
                      });
                    }
                  }}
                />
              </Field>

              <Field label={t('Redaction type')}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button
                    variant={redactType === 'blur' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setRedactType('blur');
                      if (selectedLayer && selectedLayer.type === 'redact') {
                        pushDoc({
                          ...doc,
                          layers: doc.layers.map((l) =>
                            l.id === selectedLayer.id && l.type === 'redact' ? { ...l, redactType: 'blur' } : l,
                          ),
                        });
                      }
                    }}
                  >
                    {t('Blur')}
                  </Button>
                  <Button
                    variant={redactType === 'pixelate' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setRedactType('pixelate');
                      if (selectedLayer && selectedLayer.type === 'redact') {
                        pushDoc({
                          ...doc,
                          layers: doc.layers.map((l) =>
                            l.id === selectedLayer.id && l.type === 'redact' ? { ...l, redactType: 'pixelate' } : l,
                          ),
                        });
                      }
                    }}
                  >
                    {t('Pixelate')}
                  </Button>
                </div>
              </Field>
            </div>

            {/* Selected item specific controls */}
            {selectedLayer && selectedLayer.type === 'callout' && (
              <Field label={t('Callout text')}>
                <input
                  type="text"
                  className="input"
                  value={selectedLayer.text}
                  onChange={(e) => {
                    const val = e.target.value;
                    pushDoc({
                      ...doc,
                      layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'callout' ? { ...l, text: val } : l)),
                    });
                  }}
                />
              </Field>
            )}

            {selectedLayer && selectedLayer.type === 'badge' && (
              <Field label={t('Badge number')}>
                <input
                  type="number"
                  className="input"
                  style={{ maxWidth: '120px' }}
                  value={selectedLayer.number}
                  onChange={(e) => {
                    const num = parseInt(e.target.value, 10) || 1;
                    pushDoc({
                      ...doc,
                      layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'badge' ? { ...l, number: num } : l)),
                    });
                  }}
                />
              </Field>
            )}
          </div>

          {/* Export Row */}
          <div className={styles.exportRow}>
            <div className={styles.exportControls}>
              <Field label={t('Format')}>
                <Select
                  value={exportMime}
                  onChange={(e) => setExportMime(e.target.value as EncodableMime)}
                  options={[
                    { value: 'image/png', label: t('PNG') },
                    { value: 'image/jpeg', label: t('JPEG') },
                    { value: 'image/webp', label: t('WebP') },
                  ]}
                />
              </Field>

              {exportMime !== 'image/png' && (
                <Field label={t('Quality')}>
                  <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />
                </Field>
              )}
            </div>

            <Button variant="primary" data-testid="export-btn" disabled={isExporting} onClick={handleExport}>
              {isExporting ? t('Exporting…') : t('Download image')}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
