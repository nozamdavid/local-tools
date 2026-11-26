import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Crop,
  Download,
  Highlighter,
  Layers,
  Paintbrush,
  Redo2,
  RotateCcw,
  RotateCw,
  Shapes,
  SlidersHorizontal,
  Square,
  TrianglesCenterlineDashedHorizontal,
  TrianglesCenterlineDashedVertical,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { EditorShortcuts } from '../../../components/EditorShortcuts';
import { normalizeRotation, RotationControl } from '../../../components/RotationControl';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { clearPendingFiles } from '../../../lib/handoff';
import { rememberRecentFiles } from '../../../lib/recentFiles';
import { CanvasDocument, Layer, TextLayer, Adjustments } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage, CropRect, StageMode, DrawConfig, ShapeConfig } from '../_canvas/CanvasStage';
import { drawDocumentBase, exportDocument } from '../_canvas/render';
import { useI18n } from '../../../lib/i18n';
import { restorePhotoDraft, savePhotoDraft } from './photoDraft';
import { flipPhoto, getBaseTransform, rotatedSize, rotatePhoto } from './photoTransform';
import styles from './Tool.module.css';

const TOOLS = [
  { id: 'select', label: 'Layers', icon: Layers },
  { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { id: 'filters', label: 'Filters', icon: WandSparkles },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'transform', label: 'Rotate', icon: RotateCw },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'draw', label: 'Draw', icon: Paintbrush },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'redact', label: 'Redact', icon: Square },
  { id: 'export', label: 'Export settings', icon: Download },
] as const;

type TabType = (typeof TOOLS)[number]['id'];
type PhotoSource = { file: File; original: HTMLImageElement; initialDoc: CanvasDocument };

const TOOL_SHORTCUTS: Partial<Record<TabType, string>> = {
  select: 'V',
  crop: 'C',
  text: 'T',
  draw: 'B',
  highlight: 'H',
  arrow: 'A',
  shapes: 'U',
  redact: 'R',
};
const UNDO_KEYS = ['Ctrl+Z', 'Meta+Z'];
const REDO_KEYS = ['Ctrl+Shift+Z', 'Meta+Shift+Z', 'Ctrl+Y', 'Meta+Y'];
const NUDGE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

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
        icon={null}
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
  const inspectorRef = useRef<HTMLElement>(null);
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
  const { document: doc, canUndo, canRedo, undo, redo, pushDoc } = useCanvasHistory(initialDoc, { keyboardShortcuts: false });
  const base = getBaseTransform(doc);
  const [anglePreview, setAnglePreview] = useState<{ doc: CanvasDocument; angle: number } | null>(null);
  const previewAngle = activeTab === 'transform' && anglePreview?.doc === doc ? anglePreview.angle : null;
  const rotationPreview =
    previewAngle !== null ? { ...rotatedSize(base.width, base.height, previewAngle), delta: previewAngle - base.angle } : undefined;
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

  useLayoutEffect(() => {
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
  }, [activeTab]);

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

    ctx.translate(-x, -y);
    drawDocumentBase(ctx, doc, false);

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
      baseTransform: undefined,
      layers: croppedLayers,
    };

    pushDoc(newDoc);
    setCropRect({ x: 0, y: 0, width: cw, height: ch });
    setActiveTab('adjust');
  };

  const applyRotation = (angle: number) => {
    setAnglePreview(null);
    const newDoc = rotatePhoto(doc, normalizeRotation(angle));
    if (newDoc === doc) return;
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
  const exportLabel = exportMime === 'image/jpeg' ? 'JPEG' : exportMime === 'image/webp' ? 'WebP' : 'PNG';
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
    activeTab === 'transform'
      ? 'view'
      : activeTab === 'crop'
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
    if (tab !== 'transform') setAnglePreview(null);
    setActiveTab(tab);
  };

  const shortcuts = [
    ...TOOLS.flatMap(({ id, label }) => {
      const key = TOOL_SHORTCUTS[id];
      return key ? [{ label: t(label), keys: [key] }] : [];
    }),
    { label: t('Undo'), keys: UNDO_KEYS },
    { label: t('Redo'), keys: REDO_KEYS },
    { label: t('Move selected layer by one pixel'), keys: NUDGE_KEYS },
    { label: t('Move selected layer by ten pixels'), keys: NUDGE_KEYS.map((key) => `Shift+${key}`) },
    { label: t('Delete layer'), keys: ['Delete', 'Backspace'] },
  ];

  const handleWorkspaceKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    const { currentTarget, target, nativeEvent } = event;
    if (event.defaultPrevented || !(target instanceof Element) || !currentTarget.contains(target)) return;

    const key = event.key.toUpperCase();
    const command = event.ctrlKey !== event.metaKey;
    const composing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
    const alt = event.altKey || event.getModifierState('AltGraph');
    const nativeControl = target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], ' +
        '[role="slider"], [role="spinbutton"]',
    );
    const nestedOverlay = target.closest('dialog, [role="dialog"], [role="alertdialog"], [popover]') !== currentTarget;

    // Keep global palette triggers inside the workspace without swallowing native edits.
    if (((event.ctrlKey || event.metaKey) && key === 'K') || key === '/') {
      event.stopPropagation();
      const paletteShortcut = key === 'K' ? command && !event.shiftKey : !event.ctrlKey && !event.metaKey && !event.shiftKey;
      if (paletteShortcut && !composing && !alt && !nativeControl && !nestedOverlay) event.preventDefault();
      return;
    }
    if (composing || alt || closing || closeFailed || nativeControl || nestedOverlay || window.getSelection()?.isCollapsed === false)
      return;

    if (command && (key === 'Z' || (key === 'Y' && !event.shiftKey))) {
      event.preventDefault();
      if (key === 'Y' || event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;

    const nextTool = TOOLS.find(({ id }) => TOOL_SHORTCUTS[id] === key);
    if (nextTool) {
      event.preventDefault();
      selectTool(nextTool.id);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      data-editor-workspace
      className={styles.workspace}
      aria-label={t('Photo Editor')}
      onKeyDown={handleWorkspaceKey}
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
            aria-keyshortcuts="Control+Z Meta+Z"
            title={`${t('Undo')} (Ctrl+Z / ⌘Z)`}
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
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
            title={`${t('Redo')} (Ctrl+Shift+Z / ⇧⌘Z)`}
            data-testid="redo-btn"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </button>
          <EditorShortcuts shortcuts={shortcuts} />
        </div>
        <div className={styles.exportActions}>
          <CopyImageButton getImage={getExportBlob} disabled={isExporting} size="sm" filename={exportFilename} />
          <Button
            variant="secondary"
            size="sm"
            className={styles.formatButton}
            title={t('Export settings')}
            aria-label={`${t('Export settings')} (${exportLabel})`}
            aria-pressed={activeTab === 'export'}
            aria-controls="photo-inspector"
            onClick={() => selectTool('export')}
          >
            {exportLabel}
            <ChevronDown aria-hidden="true" />
          </Button>
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
          {TOOLS.filter(({ id }) => id !== 'export').map(({ id, label, icon: Icon }) => {
            const key = TOOL_SHORTCUTS[id];
            const name = t(label);
            return (
              <button
                key={id}
                type="button"
                className={styles.toolButton}
                aria-pressed={activeTab === id}
                aria-keyshortcuts={key}
                title={key ? `${name} (${key})` : name}
                onClick={() => selectTool(id)}
              >
                <span className={styles.toolIcon}>
                  <Icon aria-hidden="true" />
                  {key && (
                    <kbd className={styles.toolKey} aria-hidden="true">
                      {key}
                    </kbd>
                  )}
                </span>
                <span>{name}</span>
              </button>
            );
          })}
        </nav>

        <CanvasStage
          document={doc}
          selectedLayerId={selectedLayer?.id ?? null}
          mode={stageMode}
          cropRect={activeTab === 'crop' ? cropRect : undefined}
          rotationPreview={rotationPreview}
          onCropChange={setCropRect}
          drawConfig={activeDraw}
          shapeConfig={currentShape}
          workspace
          onSelectLayer={setSelectedLayerId}
          onPushDoc={pushDoc}
          onDeleteLayer={closing || closeFailed ? undefined : deleteLayer}
        />

        <aside id="photo-inspector" ref={inspectorRef} className={styles.inspector} aria-labelledby="photo-inspector-title">
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
                      variant={(doc.adjustments?.preset ?? 'none') === p.id ? 'primary' : 'secondary'}
                      aria-pressed={(doc.adjustments?.preset ?? 'none') === p.id}
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
              <>
                <RotationControl
                  angle={base.angle}
                  onChange={applyRotation}
                  onPreview={(angle) => setAnglePreview(angle === null ? null : { doc, angle })}
                />
                <div className={styles.transformActions} role="group" aria-label={t('Rotate and flip')}>
                  {[
                    { label: 'Rotate 90° counterclockwise', icon: RotateCcw, angle: -90, onClick: () => applyRotation(base.angle - 90) },
                    { label: 'Rotate 90° clockwise', icon: RotateCw, angle: 90, onClick: () => applyRotation(base.angle + 90) },
                    { label: 'Flip horizontal', icon: TrianglesCenterlineDashedVertical, onClick: () => pushDoc(flipPhoto(doc, true)) },
                    { label: 'Flip vertical', icon: TrianglesCenterlineDashedHorizontal, onClick: () => pushDoc(flipPhoto(doc, false)) },
                  ].map(({ label, icon: Icon, angle, onClick }) => (
                    <Button
                      key={label}
                      variant="secondary"
                      size="sm"
                      title={t(label)}
                      aria-label={t(label)}
                      icon={<Icon aria-hidden="true" />}
                      onClick={onClick}
                    >
                      {angle && '90°'}
                    </Button>
                  ))}
                </div>
              </>
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
                  title={`${t('Delete layer')} (${t('Delete')} / ${t('Backspace')})`}
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
