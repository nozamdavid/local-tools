import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { CanvasDocument, Layer, TextLayer, RectLayer, EllipseLayer, ArrowLayer, LineLayer } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage, CropRect, StageMode, DrawConfig, ShapeConfig } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import styles from './Tool.module.css';

type TabType = 'adjust' | 'filters' | 'crop' | 'transform' | 'text' | 'draw' | 'shapes';

export default function Tool() {
  const meta = getToolMeta('img-photo-editor');

  const [file, setFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('adjust');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Format & export
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
    adjustments: {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      blur: 0,
      preset: 'none',
    },
    layers: [],
  });

  // Crop state
  const [cropAspect, setCropAspect] = useState<string>('free');
  const [cropRect, setCropRect] = useState<CropRect>({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });

  // Draw config
  const [drawConfig, setDrawConfig] = useState<DrawConfig>({
    stroke: '#ef4444',
    strokeWidth: 6,
    isEraser: false,
    isHighlighter: false,
  });

  // Shape config
  const [shapeConfig, setShapeConfig] = useState<ShapeConfig>({
    type: 'rect',
    stroke: '#ef4444',
    strokeWidth: 4,
    fill: 'transparent',
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
        adjustments: {
          brightness: 100,
          contrast: 100,
          saturation: 100,
          blur: 0,
          preset: 'none',
        },
        layers: [],
      };
      resetHistory(newDoc);
      setSelectedLayerId(null);
      setCropRect({ x: 0, y: 0, width: img.width, height: img.height });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to decode image.');
    }
  };

  // Adjustments updater
  const updateAdjustment = (key: 'brightness' | 'contrast' | 'saturation' | 'blur', val: number) => {
    const newDoc: CanvasDocument = {
      ...doc,
      adjustments: {
        ...(doc.adjustments || { brightness: 100, contrast: 100, saturation: 100, blur: 0, preset: 'none' }),
        [key]: val,
      },
    };
    pushDoc(newDoc);
  };

  const setFilterPreset = (preset: 'none' | 'vivid' | 'mono' | 'sepia' | 'vintage' | 'cool' | 'warm') => {
    const newDoc: CanvasDocument = {
      ...doc,
      adjustments: {
        ...(doc.adjustments || { brightness: 100, contrast: 100, saturation: 100, blur: 0 }),
        preset,
      },
    };
    pushDoc(newDoc);
  };

  // Crop aspect change
  const handleAspectChange = (aspect: string) => {
    setCropAspect(aspect);
    let targetW = doc.width;
    let targetH = doc.height;

    if (aspect === '1:1') {
      const size = Math.min(doc.width, doc.height);
      targetW = size;
      targetH = size;
    } else if (aspect === '4:3') {
      targetH = Math.round((targetW * 3) / 4);
      if (targetH > doc.height) {
        targetH = doc.height;
        targetW = Math.round((targetH * 4) / 3);
      }
    } else if (aspect === '16:9') {
      targetH = Math.round((targetW * 9) / 16);
      if (targetH > doc.height) {
        targetH = doc.height;
        targetW = Math.round((targetH * 16) / 9);
      }
    } else if (aspect === '3:2') {
      targetH = Math.round((targetW * 2) / 3);
      if (targetH > doc.height) {
        targetH = doc.height;
        targetW = Math.round((targetH * 3) / 2);
      }
    } else if (aspect === '9:16') {
      targetW = Math.round((targetH * 9) / 16);
      if (targetW > doc.width) {
        targetW = doc.width;
        targetH = Math.round((targetW * 16) / 9);
      }
    }

    const x = Math.max(0, Math.round((doc.width - targetW) / 2));
    const y = Math.max(0, Math.round((doc.height - targetH) / 2));
    setCropRect({ x, y, width: targetW, height: targetH });
  };

  // Apply Crop
  const applyCrop = () => {
    if (!doc.baseImage) return;
    const { x, y, width: cw, height: ch } = cropRect;
    if (cw <= 10 || ch <= 10) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = cw;
    offscreen.height = ch;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(doc.baseImage, x, y, cw, ch, 0, 0, cw, ch);

    const croppedLayers = doc.layers.map((l) => {
      if (l.type === 'path') {
        return {
          ...l,
          points: l.points.map((p) => ({ x: p.x - x, y: p.y - y })),
        };
      }
      return {
        ...l,
        x: l.x - x,
        y: l.y - y,
      };
    });

    const newDoc: CanvasDocument = {
      ...doc,
      width: cw,
      height: ch,
      baseImage: offscreen,
      layers: croppedLayers,
    };

    pushDoc(newDoc);
    setCropRect({ x: 0, y: 0, width: cw, height: ch });
    setActiveTab('adjust');
  };

  // Rotate 90 CW / CCW
  const rotateBase = (clockwise: boolean) => {
    if (!doc.baseImage) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = doc.height;
    offscreen.height = doc.width;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.translate(offscreen.width / 2, offscreen.height / 2);
    ctx.rotate((clockwise ? 90 : -90) * (Math.PI / 180));
    ctx.drawImage(doc.baseImage, -doc.width / 2, -doc.height / 2);
    ctx.restore();

    const transformedLayers = doc.layers.map((l) => {
      if (clockwise) {
        if (l.type === 'path') {
          return {
            ...l,
            points: l.points.map((p) => ({ x: doc.height - p.y, y: p.x })),
          };
        }
        return {
          ...l,
          x: doc.height - (l.y + l.height),
          y: l.x,
          width: l.height,
          height: l.width,
          rotation: Math.round(((l.rotation || 0) + 90) % 360),
        };
      } else {
        if (l.type === 'path') {
          return {
            ...l,
            points: l.points.map((p) => ({ x: p.y, y: doc.width - p.x })),
          };
        }
        return {
          ...l,
          x: l.y,
          y: doc.width - (l.x + l.width),
          width: l.height,
          height: l.width,
          rotation: Math.round(((l.rotation || 0) - 90) % 360),
        };
      }
    });

    const newDoc: CanvasDocument = {
      ...doc,
      width: offscreen.width,
      height: offscreen.height,
      baseImage: offscreen,
      layers: transformedLayers,
    };

    pushDoc(newDoc);
    setCropRect({ x: 0, y: 0, width: newDoc.width, height: newDoc.height });
  };

  // Flip Horizontal / Vertical
  const flipBase = (horizontal: boolean) => {
    if (!doc.baseImage) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = doc.width;
    offscreen.height = doc.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (horizontal) {
      ctx.translate(doc.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, doc.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(doc.baseImage, 0, 0);
    ctx.restore();

    const transformedLayers = doc.layers.map((l) => {
      if (horizontal) {
        if (l.type === 'path') {
          return {
            ...l,
            points: l.points.map((p) => ({ x: doc.width - p.x, y: p.y })),
          };
        }
        return {
          ...l,
          x: doc.width - (l.x + l.width),
        };
      } else {
        if (l.type === 'path') {
          return {
            ...l,
            points: l.points.map((p) => ({ x: p.x, y: doc.height - p.y })),
          };
        }
        return {
          ...l,
          y: doc.height - (l.y + l.height),
        };
      }
    });

    const newDoc: CanvasDocument = {
      ...doc,
      baseImage: offscreen,
      layers: transformedLayers,
    };

    pushDoc(newDoc);
  };

  // Add text layer
  const addTextLayer = () => {
    const newId = 'text-' + Date.now();
    const w = 220;
    const h = 50;
    const newLayer: TextLayer = {
      id: newId,
      type: 'text',
      text: 'Sample Text',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      fontSize: 32,
      fontFamily: 'sans',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 3,
      opacity: 1,
    };

    pushDoc({
      ...doc,
      layers: [...doc.layers, newLayer],
    });
    setSelectedLayerId(newId);
  };

  // Add shape
  const addShapeLayer = (type: 'rect' | 'ellipse' | 'arrow' | 'line') => {
    const newId = 'shape-' + Date.now();
    const w = 180;
    const h = type === 'arrow' || type === 'line' ? 30 : 120;
    const x = Math.max(10, Math.round(doc.width / 2 - w / 2));
    const y = Math.max(10, Math.round(doc.height / 2 - h / 2));

    let newLayer: Layer;
    if (type === 'rect') {
      newLayer = {
        id: newId,
        type: 'rect',
        x,
        y,
        width: w,
        height: h,
        stroke: shapeConfig.stroke,
        strokeWidth: shapeConfig.strokeWidth,
        fill: shapeConfig.fill || 'transparent',
      } as RectLayer;
    } else if (type === 'ellipse') {
      newLayer = {
        id: newId,
        type: 'ellipse',
        x,
        y,
        width: w,
        height: h,
        stroke: shapeConfig.stroke,
        strokeWidth: shapeConfig.strokeWidth,
        fill: shapeConfig.fill || 'transparent',
      } as EllipseLayer;
    } else if (type === 'arrow') {
      newLayer = {
        id: newId,
        type: 'arrow',
        x,
        y,
        width: w,
        height: 24,
        stroke: shapeConfig.stroke,
        strokeWidth: shapeConfig.strokeWidth,
      } as ArrowLayer;
    } else {
      newLayer = {
        id: newId,
        type: 'line',
        x,
        y,
        width: w,
        height: 24,
        stroke: shapeConfig.stroke,
        strokeWidth: shapeConfig.strokeWidth,
      } as LineLayer;
    }

    pushDoc({
      ...doc,
      layers: [...doc.layers, newLayer],
    });
    setSelectedLayerId(newId);
  };

  // Delete layer
  const deleteLayer = (id: string) => {
    pushDoc({
      ...doc,
      layers: doc.layers.filter((l) => l.id !== id),
    });
    if (selectedLayerId === id) {
      setSelectedLayerId(null);
    }
  };

  // Export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportDocument(doc, exportMime, quality / 100);
      const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
      const outName = withSuffix(file ? file.name : 'edited-photo.png', '-edited', ext);
      downloadBlob(blob, outName);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId);

  // Determine stage mode
  let stageMode: StageMode = 'select';
  if (activeTab === 'crop') stageMode = 'crop';
  else if (activeTab === 'draw') stageMode = 'draw';
  else if (activeTab === 'shapes') stageMode = 'select';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-photo-editor">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image to edit"
          hint="Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, SVG"
          onFiles={handleFileDrop}
        />
      ) : (
        <div className={styles.editorContainer}>
          {/* Top Bar with History & Tabs */}
          <div className={styles.topBar}>
            <div className={styles.historyGroup}>
              <button
                type="button"
                className={styles.iconBtn}
                title="Undo (Ctrl+Z)"
                data-testid="undo-btn"
                disabled={!canUndo}
                onClick={undo}
              >
                ↩
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                title="Redo (Ctrl+Shift+Z)"
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
                  title="Delete layer (Del)"
                  onClick={() => deleteLayer(selectedLayerId)}
                  style={{ color: 'var(--danger)' }}
                >
                  🗑
                </button>
              )}
            </div>

            <div className={styles.tabsRow}>
              {(['adjust', 'filters', 'crop', 'transform', 'text', 'draw', 'shapes'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'adjust' && 'Adjust'}
                  {tab === 'filters' && 'Filters'}
                  {tab === 'crop' && 'Crop'}
                  {tab === 'transform' && 'Rotate / Flip'}
                  {tab === 'text' && 'Text'}
                  {tab === 'draw' && 'Draw'}
                  {tab === 'shapes' && 'Shapes'}
                </button>
              ))}
            </div>

            <Button variant="secondary" onClick={() => setFile(null)}>
              Change Image
            </Button>
          </div>

          {/* Interactive Canvas Stage */}
          <CanvasStage
            document={doc}
            selectedLayerId={selectedLayerId}
            mode={stageMode}
            drawConfig={drawConfig}
            shapeConfig={shapeConfig}
            cropRect={cropRect}
            onCropChange={setCropRect}
            onSelectLayer={setSelectedLayerId}
            onUpdateDocSilent={updateDocSilent}
            onPushDoc={pushDoc}
            onDeleteLayer={deleteLayer}
          />

          {/* Active Tab Panel */}
          <div className={styles.controlsPanel}>
            {activeTab === 'adjust' && (
              <div className={styles.controlGrid}>
                <Field label="Brightness">
                  <Slider
                    value={doc.adjustments?.brightness ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('brightness', v)}
                  />
                </Field>
                <Field label="Contrast">
                  <Slider
                    value={doc.adjustments?.contrast ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('contrast', v)}
                  />
                </Field>
                <Field label="Saturation">
                  <Slider
                    value={doc.adjustments?.saturation ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('saturation', v)}
                  />
                </Field>
                <Field label="Blur">
                  <Slider
                    value={doc.adjustments?.blur ?? 0}
                    min={0}
                    max={20}
                    unit="px"
                    onChange={(v) => updateAdjustment('blur', v)}
                  />
                </Field>
              </div>
            )}

            {activeTab === 'filters' && (
              <Field label="Filter Presets">
                <div className={styles.btnGroup}>
                  {[
                    { id: 'none', label: 'Original' },
                    { id: 'vivid', label: 'Vivid' },
                    { id: 'mono', label: 'Mono' },
                    { id: 'sepia', label: 'Sepia' },
                    { id: 'vintage', label: 'Vintage' },
                    { id: 'cool', label: 'Cool' },
                    { id: 'warm', label: 'Warm' },
                  ].map((p) => (
                    <Button
                      key={p.id}
                      variant={doc.adjustments?.preset === p.id ? 'primary' : 'secondary'}
                      onClick={() => setFilterPreset(p.id as any)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </Field>
            )}

            {activeTab === 'crop' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label="Aspect Ratio Preset">
                  <div className={styles.btnGroup}>
                    {['free', '1:1', '4:3', '16:9', '3:2', '9:16'].map((asp) => (
                      <Button
                        key={asp}
                        variant={cropAspect === asp ? 'primary' : 'secondary'}
                        onClick={() => handleAspectChange(asp)}
                      >
                        {asp.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </Field>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <Button variant="primary" onClick={applyCrop}>
                    Apply Crop
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCropRect({ x: 0, y: 0, width: doc.width, height: doc.height });
                      setActiveTab('adjust');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'transform' && (
              <Field label="Rotate & Flip">
                <div className={styles.btnGroup}>
                  <Button variant="secondary" onClick={() => rotateBase(true)}>
                    Rotate 90° CW
                  </Button>
                  <Button variant="secondary" onClick={() => rotateBase(false)}>
                    Rotate 90° CCW
                  </Button>
                  <Button variant="secondary" onClick={() => flipBase(true)}>
                    Flip Horizontal
                  </Button>
                  <Button variant="secondary" onClick={() => flipBase(false)}>
                    Flip Vertical
                  </Button>
                </div>
              </Field>
            )}

            {activeTab === 'text' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Button variant="primary" onClick={addTextLayer}>
                    + Add Text
                  </Button>
                </div>

                {selectedLayer && selectedLayer.type === 'text' && (
                  <div className={styles.controlGrid}>
                    <Field label="Text Content">
                      <input
                        type="text"
                        className="input"
                        value={selectedLayer.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          pushDoc({
                            ...doc,
                            layers: doc.layers.map((l) =>
                              l.id === selectedLayer.id && l.type === 'text' ? { ...l, text: val } : l
                            ),
                          });
                        }}
                      />
                    </Field>
                    <Field label="Font Size">
                      <Slider
                        value={selectedLayer.fontSize}
                        min={12}
                        max={120}
                        unit="px"
                        onChange={(val) => {
                          pushDoc({
                            ...doc,
                            layers: doc.layers.map((l) =>
                              l.id === selectedLayer.id && l.type === 'text' ? { ...l, fontSize: val } : l
                            ),
                          });
                        }}
                      />
                    </Field>
                    <Field label="Text Color">
                      <div className={styles.colorInputRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedLayer.fill}
                          onChange={(e) => {
                            const val = e.target.value;
                            pushDoc({
                              ...doc,
                              layers: doc.layers.map((l) =>
                                l.id === selectedLayer.id && l.type === 'text' ? { ...l, fill: val } : l
                              ),
                            });
                          }}
                        />
                        <span>{selectedLayer.fill}</span>
                      </div>
                    </Field>
                    <Field label="Stroke Color">
                      <div className={styles.colorInputRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedLayer.stroke || '#000000'}
                          onChange={(e) => {
                            const val = e.target.value;
                            pushDoc({
                              ...doc,
                              layers: doc.layers.map((l) =>
                                l.id === selectedLayer.id && l.type === 'text' ? { ...l, stroke: val } : l
                              ),
                            });
                          }}
                        />
                        <span>{selectedLayer.stroke || '#000000'}</span>
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'draw' && (
              <div className={styles.controlGrid}>
                <Field label="Tool Mode">
                  <div className={styles.btnGroup}>
                    <Button
                      variant={!drawConfig.isEraser ? 'primary' : 'secondary'}
                      onClick={() => setDrawConfig((prev) => ({ ...prev, isEraser: false }))}
                    >
                      Brush
                    </Button>
                    <Button
                      variant={drawConfig.isEraser ? 'primary' : 'secondary'}
                      onClick={() => setDrawConfig((prev) => ({ ...prev, isEraser: true }))}
                    >
                      Eraser
                    </Button>
                  </div>
                </Field>
                {!drawConfig.isEraser && (
                  <Field label="Brush Color">
                    <div className={styles.colorInputRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={drawConfig.stroke}
                        onChange={(e) => setDrawConfig((prev) => ({ ...prev, stroke: e.target.value }))}
                      />
                      <span>{drawConfig.stroke}</span>
                    </div>
                  </Field>
                )}
                <Field label="Brush Size">
                  <Slider
                    value={drawConfig.strokeWidth}
                    min={1}
                    max={50}
                    unit="px"
                    onChange={(v) => setDrawConfig((prev) => ({ ...prev, strokeWidth: v }))}
                  />
                </Field>
              </div>
            )}

            {activeTab === 'shapes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label="Add Shape">
                  <div className={styles.btnGroup}>
                    <Button variant="secondary" onClick={() => addShapeLayer('rect')}>
                      + Rectangle
                    </Button>
                    <Button variant="secondary" onClick={() => addShapeLayer('ellipse')}>
                      + Ellipse
                    </Button>
                    <Button variant="secondary" onClick={() => addShapeLayer('arrow')}>
                      + Arrow
                    </Button>
                    <Button variant="secondary" onClick={() => addShapeLayer('line')}>
                      + Line
                    </Button>
                  </div>
                </Field>

                <div className={styles.controlGrid}>
                  <Field label="Stroke Color">
                    <div className={styles.colorInputRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={shapeConfig.stroke}
                        onChange={(e) => setShapeConfig((prev) => ({ ...prev, stroke: e.target.value }))}
                      />
                      <span>{shapeConfig.stroke}</span>
                    </div>
                  </Field>
                  <Field label="Stroke Width">
                    <Slider
                      value={shapeConfig.strokeWidth}
                      min={1}
                      max={20}
                      unit="px"
                      onChange={(v) => setShapeConfig((prev) => ({ ...prev, strokeWidth: v }))}
                    />
                  </Field>
                  <Field label="Fill Color">
                    <div className={styles.colorInputRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={shapeConfig.fill === 'transparent' ? '#ffffff' : shapeConfig.fill || '#ffffff'}
                        onChange={(e) => setShapeConfig((prev) => ({ ...prev, fill: e.target.value }))}
                      />
                      <Button
                        variant={shapeConfig.fill === 'transparent' ? 'primary' : 'secondary'}
                        onClick={() => setShapeConfig((prev) => ({ ...prev, fill: 'transparent' }))}
                      >
                        Transparent
                      </Button>
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* Export Row */}
          <div className={styles.exportRow}>
            <div className={styles.exportControls}>
              <Field label="Format">
                <Select
                  value={exportMime}
                  onChange={(e) => setExportMime(e.target.value as EncodableMime)}
                  options={[
                    { value: 'image/png', label: 'PNG' },
                    { value: 'image/jpeg', label: 'JPEG' },
                    { value: 'image/webp', label: 'WebP' },
                  ]}
                />
              </Field>

              {exportMime !== 'image/png' && (
                <Field label="Quality">
                  <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />
                </Field>
              )}
            </div>

            <Button
              variant="primary"
              data-testid="export-btn"
              disabled={isExporting}
              onClick={handleExport}
            >
              {isExporting ? 'Exporting…' : 'Download Image'}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
