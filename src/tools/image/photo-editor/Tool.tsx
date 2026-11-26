import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Crop,
  Download,
  Highlighter,
  Layers,
  MousePointer2,
  Paintbrush,
  Redo2,
  RotateCw,
  Shapes,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { clearPendingFiles } from '../../../lib/handoff';
import { rememberRecentFiles } from '../../../lib/recentFiles';
import { CanvasDocument, Layer, TextLayer, Adjustments } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage, CropRect, StageMode, DrawConfig, ShapeConfig } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import { useI18n } from '../../../lib/i18n';
import { restorePhotoDraft, savePhotoDraft } from './photoDraft';
import styles from './Tool.module.css';

const TOOLS = [
  { id: 'select', label: 'Select layer', icon: MousePointer2 },
  { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { id: 'filters', label: 'Filters', icon: WandSparkles },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'transform', label: 'Rotate', icon: RotateCw },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'draw', label: 'Draw', icon: Paintbrush },
  { id: 'highlight', label: 'Highlighter', icon: Highlighter },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'redact', label: 'Redact', icon: Square },
  { id: 'export', label: 'Export settings', icon: Download },
] as const;

type TabType = (typeof TOOLS)[number]['id'];
type PhotoSource = { file: File; original: HTMLImageElement; initialDoc: CanvasDocument };

const SHAPES = [
  { type: 'rect', label: 'Rectangle' },
  { type: 'ellipse', label: 'Ellipse' },
  { type: 'line', label: 'Line' },
] as const;

const LAYER_LABELS: Partial<Record<Layer['type'], string>> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  line: 'Line',
  redact: 'Redaction',
};

let draftWrites: Promise<unknown> = Promise.resolve();

export default function Tool() {
  const meta = getToolMeta('img-photo-editor');
  const { t } = useI18n();
  const [source, setSource] = useState<PhotoSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleFileDrop = async ([file]: File[]) => {
    if (!file) return;
    const requestId = ++request.current;
    const isCurrent = () => mounted.current && request.current === requestId;
    setLoading(true);
    setLoadError('');
    try {
      const original = await decodeImage(file);
      if (!isCurrent()) return;
      await rememberRecentFiles([file], '/image/photo-editor').catch(() => {});
      await draftWrites;
      if (!isCurrent()) return;
      const restored = await restorePhotoDraft(file, original).catch(() => null);
      if (!isCurrent()) return;
      setSource({
        file,
        original,
        initialDoc: restored ?? {
          width: original.width,
          height: original.height,
          baseImage: original,
          adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0, preset: 'none' },
          layers: [],
        },
      });
    } catch (error) {
      if (isCurrent()) setLoadError(error instanceof Error ? error.message : 'Failed to decode image.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  if (source) return <PhotoWorkspace {...source} />;
  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-photo-editor">
      <FileDrop
        accept={IMAGE_ACCEPT}
        label={t('Choose an image to edit')}
        hint={t('Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC and SVG.')}
        onFiles={handleFileDrop}
      />
      {loading && <p role="status">{t('Opening image…')}</p>}
      {loadError && (
        <p role="alert" className="field-error">
          {t(loadError)}
        </p>
      )}
    </ToolPage>
  );
}

function PhotoWorkspace({ file, original, initialDoc }: PhotoSource) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const closeGuardRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabType>('adjust');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const [exportError, setExportError] = useState('');
  const closePending = useRef(false);
  const leaving = useRef(false);
  const attached = useRef(false);

  // Format & export
  const [exportMime, setExportMime] = useState<EncodableMime>('image/png');
  const [quality, setQuality] = useState<number>(92);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Canvas history
  const { document: doc, canUndo, canRedo, undo, redo, pushDoc } = useCanvasHistory(initialDoc);
  const latestDoc = useRef(doc);
  const savedDoc = useRef(doc);

  const queueDraftSave = useCallback(
    (snapshot: CanvasDocument) => {
      const result = draftWrites
        .then(async () => {
          if (leaving.current || snapshot !== latestDoc.current || savedDoc.current === snapshot) return true;
          const saved = await savePhotoDraft(file, snapshot, original);
          if (saved) savedDoc.current = snapshot;
          return saved;
        })
        .catch(() => false);
      draftWrites = result;
      return result;
    },
    [file, original],
  );

  useLayoutEffect(() => {
    latestDoc.current = doc;
  }, [doc]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void queueDraftSave(doc);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [doc, queueDraftSave]);

  useEffect(() => {
    const flushDraft = () => {
      if (!leaving.current) void queueDraftSave(latestDoc.current);
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [queueDraftSave]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    attached.current = true;
    dialog.showModal();
    exitRef.current?.focus({ preventScroll: true });
    return () => {
      attached.current = false;
      dialog.close();
      root.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    if (closeFailed) closeGuardRef.current?.focus();
  }, [closeFailed]);

  const returnHome = () => {
    leaving.current = true;
    clearPendingFiles();
    void navigate('/', { replace: true });
  };

  const closeWorkspace = async () => {
    if (closePending.current) return;
    closePending.current = true;
    setClosing(true);
    setCloseFailed(false);
    while (!leaving.current) {
      const snapshot = latestDoc.current;
      const saved = await queueDraftSave(snapshot);
      if (!attached.current) return;
      if (snapshot !== latestDoc.current) continue;
      if (saved) returnHome();
      else setCloseFailed(true);
      break;
    }
    setClosing(false);
    closePending.current = false;
  };

  // Crop state
  const [cropAspect, setCropAspect] = useState<string>('free');
  const [cropSelection, setCropRect] = useState<CropRect>({
    x: 0,
    y: 0,
    width: initialDoc.width,
    height: initialDoc.height,
  });
  const cropX = Math.min(cropSelection.x, doc.width - 1);
  const cropY = Math.min(cropSelection.y, doc.height - 1);
  const cropRect = {
    x: cropX,
    y: cropY,
    width: Math.min(cropSelection.width, doc.width - cropX),
    height: Math.min(cropSelection.height, doc.height - cropY),
  };

  // Draw config
  const [drawConfig, setDrawConfig] = useState<DrawConfig>({
    stroke: '#ef4444',
    strokeWidth: 6,
    isEraser: false,
    isHighlighter: false,
  });
  const [highlightConfig, setHighlightConfig] = useState<DrawConfig>({
    stroke: '#ffdb31',
    strokeWidth: 32,
    isHighlighter: true,
  });

  // Shape config
  const [shapeConfig, setShapeConfig] = useState<ShapeConfig>({
    type: 'rect',
    stroke: '#ef4444',
    strokeWidth: 4,
    fill: 'transparent',
  });

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

  const setFilterPreset = (preset: Adjustments['preset']) => {
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
    setCropRect({ x, y, width: Math.max(1, targetW), height: Math.max(1, targetH) });
  };

  // Apply Crop
  const applyCrop = () => {
    if (!doc.baseImage) return;
    const { x, y, width: cw, height: ch } = cropRect;
    if (cw < 1 || ch < 1) return;

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

    const rotatePoint = ({ x, y }: { x: number; y: number }) => (clockwise ? { x: doc.height - y, y: x } : { x: y, y: doc.width - x });

    const transformedLayers = doc.layers.map((layer) => {
      if (layer.type === 'path') return { ...layer, points: layer.points.map(rotatePoint) };
      const center = rotatePoint({ x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 });
      if (layer.type === 'redact') {
        return { ...layer, x: center.x - layer.height / 2, y: center.y - layer.width / 2, width: layer.height, height: layer.width };
      }
      return {
        ...layer,
        x: center.x - layer.width / 2,
        y: center.y - layer.height / 2,
        rotation: ((layer.rotation ?? 0) + (clockwise ? 90 : -90)) % 360,
      };
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

    const flipPoint = ({ x, y }: { x: number; y: number }) => (horizontal ? { x: doc.width - x, y } : { x, y: doc.height - y });

    const transformedLayers = doc.layers.map((layer) => {
      if (layer.type === 'path') return { ...layer, points: layer.points.map(flipPoint) };
      const center = flipPoint({ x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 });
      return {
        ...layer,
        x: center.x - layer.width / 2,
        y: center.y - layer.height / 2,
        rotation: -(layer.rotation ?? 0),
        flipX: horizontal ? !layer.flipX : layer.flipX,
        flipY: horizontal ? layer.flipY : !layer.flipY,
      };
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
      text: t('Sample Text'),
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

  const addShapeLayer = (type: ShapeConfig['type']) => {
    const width = Math.min(doc.width, type === 'redact' ? Math.max(1, Math.round(doc.width * 0.4)) : 180);
    const height = Math.min(doc.height, type === 'arrow' || type === 'line' ? 24 : Math.max(1, width * 0.67));
    const bounds = {
      id: 'shape-' + Date.now(),
      x: (doc.width - width) / 2,
      y: (doc.height - height) / 2,
      width,
      height,
    };
    const layer: Layer =
      type === 'redact'
        ? { ...bounds, type, redactType: 'solid' }
        : { ...bounds, type, stroke: shapeConfig.stroke, strokeWidth: shapeConfig.strokeWidth, fill: shapeConfig.fill };
    pushDoc({ ...doc, layers: [...doc.layers, layer] });
    setSelectedLayerId(layer.id);
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
  const exportExt = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
  const exportFilename = withSuffix(file.name, '-edited', exportExt);

  const getExportBlob = () => exportDocument(doc, exportMime, quality / 100);

  const handleExport = async () => {
    setExportError('');
    setIsExporting(true);
    try {
      downloadBlob(await getExportBlob(), exportFilename);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId);

  const tool = TOOLS.find(({ id }) => id === activeTab) ?? TOOLS[0];
  const stageMode: StageMode =
    activeTab === 'crop'
      ? 'crop'
      : activeTab === 'draw' || activeTab === 'highlight'
        ? 'draw'
        : activeTab === 'shapes' || activeTab === 'redact' || activeTab === 'arrow'
          ? 'shape'
          : 'select';
  const activeDraw = activeTab === 'highlight' ? highlightConfig : drawConfig;
  const setActiveDraw = activeTab === 'highlight' ? setHighlightConfig : setDrawConfig;
  const currentShape: ShapeConfig = {
    ...shapeConfig,
    type: activeTab === 'redact' || activeTab === 'arrow' ? activeTab : shapeConfig.type,
    redactType: 'solid',
  };

  const layerLabel = (layer: Layer, number: number) => {
    if (layer.type === 'text' && layer.text.trim()) return layer.text;
    const label =
      layer.type === 'path' ? (layer.isHighlighter ? 'Highlighter' : layer.isEraser ? 'Eraser' : 'Brush') : LAYER_LABELS[layer.type];
    return label ? t('{tool} {number}', { tool: t(label), number }) : t('Layer {number}', { number });
  };

  const selectTool = (tab: TabType) => {
    if (tab === 'crop' && activeTab !== 'crop') handleAspectChange('free');
    setActiveTab(tab);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.workspace}
      aria-label={t('Photo Editor')}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') event.preventDefault();
        if (
          event.key === '/' &&
          event.target instanceof HTMLElement &&
          !event.target.closest('input, textarea, select, [contenteditable="true"]')
        )
          event.preventDefault();
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        void closeWorkspace();
      }}
    >
      <header className={styles.topBar}>
        <button
          ref={exitRef}
          type="button"
          className={styles.iconBtn}
          aria-label={t('Exit editor')}
          title={t('Exit editor')}
          aria-disabled={closing}
          onClick={() => void closeWorkspace()}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 className={styles.filename} title={file.name}>
          {file.name}
        </h1>
        <div className={styles.historyGroup}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={t('Undo')}
            title={t('Undo (Ctrl+Z)')}
            data-testid="undo-btn"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={t('Redo')}
            title={t('Redo (Ctrl+Shift+Z)')}
            data-testid="redo-btn"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </button>
        </div>
        <div className={styles.exportActions}>
          <CopyImageButton getImage={getExportBlob} disabled={isExporting} size="sm" filename={exportFilename} />
          <Button
            variant="primary"
            size="sm"
            icon={<Download aria-hidden="true" />}
            data-testid="export-btn"
            loading={isExporting}
            onClick={handleExport}
          >
            {t('Download')}
          </Button>
        </div>
      </header>

      {closing && (
        <p className={styles.notice} role="status">
          {t('Saving edits…')}
        </p>
      )}
      {closeFailed && (
        <div className={styles.notice} ref={closeGuardRef} tabIndex={-1}>
          <p role="alert">{t('Your latest edits could not be saved for reopening.')}</p>
          <div className={styles.btnGroup}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCloseFailed(false);
                exitRef.current?.focus();
              }}
            >
              {t('Keep editing')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void closeWorkspace()}>
              {t('Retry save')}
            </Button>
            <Button size="sm" variant="danger" onClick={returnHome}>
              {t('Exit without saving edits')}
            </Button>
          </div>
        </div>
      )}
      {exportError && (
        <p className={styles.notice} role="alert">
          {t(exportError)}
        </p>
      )}

      <div className={styles.workArea}>
        <nav className={styles.toolRail} aria-label={t('Photo editing tools')}>
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={styles.toolButton}
              aria-pressed={activeTab === id}
              title={t(label)}
              onClick={() => selectTool(id)}
            >
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>

        <CanvasStage
          document={doc}
          selectedLayerId={selectedLayer?.id ?? null}
          mode={stageMode}
          cropRect={cropRect}
          onCropChange={setCropRect}
          drawConfig={activeDraw}
          shapeConfig={currentShape}
          workspace
          onSelectLayer={setSelectedLayerId}
          onPushDoc={pushDoc}
          onDeleteLayer={deleteLayer}
        />

        <aside className={styles.inspector} aria-labelledby="photo-inspector-title">
          <section className={styles.controlsPanel}>
            <h2 id="photo-inspector-title">{t(tool.label)}</h2>
            {activeTab === 'adjust' && (
              <div className={styles.controlGrid}>
                <Field label={t('Brightness')}>
                  <Slider
                    value={doc.adjustments?.brightness ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('brightness', v)}
                  />
                </Field>
                <Field label={t('Contrast')}>
                  <Slider
                    value={doc.adjustments?.contrast ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('contrast', v)}
                  />
                </Field>
                <Field label={t('Saturation')}>
                  <Slider
                    value={doc.adjustments?.saturation ?? 100}
                    min={0}
                    max={200}
                    unit="%"
                    onChange={(v) => updateAdjustment('saturation', v)}
                  />
                </Field>
                <Field label={t('Blur')}>
                  <Slider value={doc.adjustments?.blur ?? 0} min={0} max={20} unit="px" onChange={(v) => updateAdjustment('blur', v)} />
                </Field>
              </div>
            )}

            {activeTab === 'filters' && (
              <Field label={t('Filter presets')}>
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
                      onClick={() => setFilterPreset(p.id as Adjustments['preset'])}
                    >
                      {t(p.label)}
                    </Button>
                  ))}
                </div>
              </Field>
            )}

            {activeTab === 'crop' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={t('Aspect ratio preset')}>
                  <div className={styles.btnGroup}>
                    {['free', '1:1', '4:3', '16:9', '3:2', '9:16'].map((asp) => (
                      <Button key={asp} variant={cropAspect === asp ? 'primary' : 'secondary'} onClick={() => handleAspectChange(asp)}>
                        {asp === 'free' ? t('Free') : asp.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </Field>
                <div className={`${styles.controlGrid} ${styles.cropFields}`}>
                  {(
                    [
                      ['x', 'X position', 0, doc.width - cropRect.width],
                      ['y', 'Y position', 0, doc.height - cropRect.height],
                      ['width', 'Width', 1, doc.width - cropRect.x],
                      ['height', 'Height', 1, doc.height - cropRect.y],
                    ] as const
                  ).map(([field, label, min, max]) => (
                    <Field key={field} label={t(label)}>
                      <input
                        className="input"
                        type="number"
                        min={min}
                        max={max}
                        value={cropRect[field]}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (!Number.isFinite(value)) return;
                          setCropAspect('free');
                          setCropRect({ ...cropRect, [field]: Math.max(min, Math.min(max, Math.round(value))) });
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <div className={styles.btnGroup}>
                  <Button variant="primary" onClick={applyCrop}>
                    {t('Apply crop')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCropRect({ x: 0, y: 0, width: doc.width, height: doc.height });
                      setActiveTab('adjust');
                    }}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'transform' && (
              <Field label={t('Rotate and flip')}>
                <div className={styles.btnGroup}>
                  <Button variant="secondary" onClick={() => rotateBase(true)}>
                    {t('Rotate 90° clockwise')}
                  </Button>
                  <Button variant="secondary" onClick={() => rotateBase(false)}>
                    {t('Rotate 90° counterclockwise')}
                  </Button>
                  <Button variant="secondary" onClick={() => flipBase(true)}>
                    {t('Flip horizontal')}
                  </Button>
                  <Button variant="secondary" onClick={() => flipBase(false)}>
                    {t('Flip vertical')}
                  </Button>
                </div>
              </Field>
            )}

            {activeTab === 'text' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Button variant="primary" onClick={addTextLayer}>
                    {t('+ Add text')}
                  </Button>
                </div>

                {selectedLayer && selectedLayer.type === 'text' && (
                  <div className={styles.controlGrid}>
                    <Field label={t('Text content')}>
                      <input
                        type="text"
                        className="input"
                        value={selectedLayer.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          pushDoc({
                            ...doc,
                            layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'text' ? { ...l, text: val } : l)),
                          });
                        }}
                      />
                    </Field>
                    <Field label={t('Font size')}>
                      <Slider
                        value={selectedLayer.fontSize}
                        min={12}
                        max={120}
                        unit="px"
                        onChange={(val) => {
                          pushDoc({
                            ...doc,
                            layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'text' ? { ...l, fontSize: val } : l)),
                          });
                        }}
                      />
                    </Field>
                    <Field label={t('Text colour')}>
                      <div className={styles.colorInputRow}>
                        <input
                          type="color"
                          aria-label={t('Text colour')}
                          className={styles.colorInput}
                          value={selectedLayer.fill}
                          onChange={(e) => {
                            const val = e.target.value;
                            pushDoc({
                              ...doc,
                              layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'text' ? { ...l, fill: val } : l)),
                            });
                          }}
                        />
                        <span>{selectedLayer.fill}</span>
                      </div>
                    </Field>
                    <Field label={t('Stroke colour')}>
                      <div className={styles.colorInputRow}>
                        <input
                          type="color"
                          aria-label={t('Stroke colour')}
                          className={styles.colorInput}
                          value={selectedLayer.stroke || '#000000'}
                          onChange={(e) => {
                            const val = e.target.value;
                            pushDoc({
                              ...doc,
                              layers: doc.layers.map((l) => (l.id === selectedLayer.id && l.type === 'text' ? { ...l, stroke: val } : l)),
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

            {(activeTab === 'draw' || activeTab === 'highlight') && (
              <div className={styles.controlGrid}>
                {activeTab === 'draw' && (
                  <Field label={t('Tool mode')}>
                    <div className={styles.btnGroup}>
                      <Button
                        size="sm"
                        variant={drawConfig.isEraser ? 'secondary' : 'primary'}
                        aria-pressed={!drawConfig.isEraser}
                        onClick={() => setDrawConfig({ ...drawConfig, isEraser: false })}
                      >
                        {t('Brush')}
                      </Button>
                      <Button
                        size="sm"
                        variant={drawConfig.isEraser ? 'primary' : 'secondary'}
                        aria-pressed={Boolean(drawConfig.isEraser)}
                        onClick={() => setDrawConfig({ ...drawConfig, isEraser: true })}
                      >
                        {t('Eraser')}
                      </Button>
                    </div>
                  </Field>
                )}
                {(!drawConfig.isEraser || activeTab === 'highlight') && (
                  <Field label={t(activeTab === 'highlight' ? 'Highlight colour' : 'Brush colour')}>
                    <input
                      type="color"
                      className={styles.colorInput}
                      value={activeDraw.stroke}
                      onChange={(event) => setActiveDraw({ ...activeDraw, stroke: event.target.value })}
                    />
                  </Field>
                )}
                <Field label={t('Brush size')}>
                  <Slider
                    value={activeDraw.strokeWidth}
                    min={1}
                    max={100}
                    unit="px"
                    onChange={(strokeWidth) => setActiveDraw({ ...activeDraw, strokeWidth })}
                  />
                </Field>
              </div>
            )}

            {(activeTab === 'shapes' || activeTab === 'arrow') && (
              <div className={styles.controlGrid}>
                <p className={styles.hint}>{t('Drag on the canvas to place a shape.')}</p>
                {activeTab === 'shapes' && (
                  <Field label={t('Shape')}>
                    <Select
                      value={shapeConfig.type}
                      options={SHAPES.map(({ type, label }) => ({ value: type, label: t(label) }))}
                      onChange={(event) => setShapeConfig({ ...shapeConfig, type: event.target.value as ShapeConfig['type'] })}
                    />
                  </Field>
                )}
                <Button variant="secondary" size="sm" onClick={() => addShapeLayer(currentShape.type)}>
                  {t('Add shape at centre')}
                </Button>
                <Field label={t('Stroke colour')}>
                  <input
                    type="color"
                    className={styles.colorInput}
                    value={shapeConfig.stroke}
                    onChange={(event) => setShapeConfig({ ...shapeConfig, stroke: event.target.value })}
                  />
                </Field>
                <Field label={t('Stroke width')}>
                  <Slider
                    value={shapeConfig.strokeWidth}
                    min={1}
                    max={20}
                    unit="px"
                    onChange={(strokeWidth) => setShapeConfig({ ...shapeConfig, strokeWidth })}
                  />
                </Field>
                {(currentShape.type === 'rect' || currentShape.type === 'ellipse') && (
                  <Field label={t('Fill colour')}>
                    <div className={styles.colorInputRow}>
                      <input
                        type="color"
                        aria-label={t('Fill colour')}
                        className={styles.colorInput}
                        value={shapeConfig.fill === 'transparent' ? '#ffffff' : (shapeConfig.fill ?? '#ffffff')}
                        onChange={(event) => setShapeConfig({ ...shapeConfig, fill: event.target.value })}
                      />
                      <Button
                        size="sm"
                        variant={shapeConfig.fill === 'transparent' ? 'primary' : 'secondary'}
                        aria-pressed={shapeConfig.fill === 'transparent'}
                        onClick={() => setShapeConfig({ ...shapeConfig, fill: 'transparent' })}
                      >
                        {t('Transparent')}
                      </Button>
                    </div>
                  </Field>
                )}
              </div>
            )}
            {activeTab === 'redact' && (
              <>
                <p className={styles.hint}>
                  {t('Drag a black box over the area to hide. Copy and Download flatten the box into the image.')}
                </p>
                <Button size="sm" variant="secondary" onClick={() => addShapeLayer('redact')}>
                  {t('Add redaction at centre')}
                </Button>
              </>
            )}
            {activeTab === 'export' && (
              <>
                <Field label={t('Format')}>
                  <Select
                    value={exportMime}
                    onChange={(event) => setExportMime(event.target.value as EncodableMime)}
                    options={[
                      { value: 'image/png', label: 'PNG' },
                      { value: 'image/jpeg', label: 'JPEG' },
                      { value: 'image/webp', label: 'WebP' },
                    ]}
                  />
                </Field>
                {exportMime !== 'image/png' && (
                  <Field label={t('Quality')}>
                    <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />
                  </Field>
                )}
              </>
            )}
            {activeTab === 'select' && doc.layers.length === 0 && (
              <p className={styles.hint}>{t('Add text, draw, or place a shape to create a layer.')}</p>
            )}
            {activeTab === 'select' && selectedLayer && selectedLayer.type !== 'path' && (
              <div className={`${styles.controlGrid} ${styles.cropFields}`}>
                {(
                  [
                    ['x', 'X position'],
                    ['y', 'Y position'],
                    ['width', 'Width'],
                    ['height', 'Height'],
                  ] as const
                ).map(([field, label]) => (
                  <Field key={field} label={t(label)}>
                    <input
                      className="input"
                      type="number"
                      min={field === 'x' || field === 'y' ? undefined : 1}
                      value={Math.round(selectedLayer[field])}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (!Number.isFinite(value)) return;
                        const nextValue = field === 'x' || field === 'y' ? Math.round(value) : Math.max(1, Math.round(value));
                        pushDoc({
                          ...doc,
                          layers: doc.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, [field]: nextValue } : layer)),
                        });
                      }}
                    />
                  </Field>
                ))}
              </div>
            )}
          </section>
          {doc.layers.length > 0 && (
            <section className={styles.layerSection} aria-labelledby="photo-layers-title">
              <div className={styles.layerHeading}>
                <h2 id="photo-layers-title">
                  <Layers aria-hidden="true" /> {t('Layers')}
                </h2>
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={!selectedLayer}
                  aria-label={t('Delete layer')}
                  title={t('Delete layer')}
                  onClick={() => selectedLayer && deleteLayer(selectedLayer.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              <ul className={styles.layerList}>
                {doc.layers
                  .map((layer, index) => (
                    <li key={layer.id}>
                      <button
                        type="button"
                        aria-pressed={layer.id === selectedLayer?.id}
                        onClick={() => {
                          setSelectedLayerId(layer.id);
                          setActiveTab(layer.type === 'text' ? 'text' : 'select');
                        }}
                      >
                        {layerLabel(layer, index + 1)}
                      </button>
                    </li>
                  ))
                  .reverse()}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}
