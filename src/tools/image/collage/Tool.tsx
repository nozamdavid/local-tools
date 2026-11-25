import { useEffect, useRef, useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { ResultPanel } from '../../../components/ResultPanel';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { IMAGE_ACCEPT, decodeImage, canvasToBlob, type EncodableMime } from '../../../lib/image';
import styles from './Tool.module.css';

interface TrayPhoto {
  id: string;
  file: File;
  img: HTMLImageElement;
  thumbUrl: string;
}

interface CellDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TemplateDef {
  id: string;
  name: string;
  cells: CellDef[];
}

interface CellState {
  photoId?: string;
  zoom: number;
  panX: number;
  panY: number;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: '2-side-by-side',
    name: '2 Side-by-Side',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: '2-stacked',
    name: '2 Stacked',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: '3-columns',
    name: '3 Columns',
    cells: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  {
    id: '3-rows',
    name: '3 Rows',
    cells: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: '1-big-2-small-right',
    name: '1 Big + 2 Small (Right)',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: '1-big-2-small-left',
    name: '1 Big + 2 Small (Left)',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 1 },
    ],
  },
  {
    id: '1-big-top-2-small',
    name: '1 Big Top + 2 Small',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: '2x2-grid',
    name: '2×2 Grid',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: '1-big-3-small',
    name: '1 Big + 3 Side',
    cells: [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 1 / 3 },
      { x: 0.6, y: 1 / 3, w: 0.4, h: 1 / 3 },
      { x: 0.6, y: 2 / 3, w: 0.4, h: 1 / 3 },
    ],
  },
  {
    id: '3x3-grid',
    name: '3×3 Grid',
    cells: [
      { x: 0, y: 0, w: 1 / 3, h: 1 / 3 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 3 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1 / 3, h: 1 / 3 },
      { x: 1 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 },
      { x: 2 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1 / 3, h: 1 / 3 },
      { x: 1 / 3, y: 2 / 3, w: 1 / 3, h: 1 / 3 },
      { x: 2 / 3, y: 2 / 3, w: 1 / 3, h: 1 / 3 },
    ],
  },
  {
    id: 'mosaic-4',
    name: 'Mosaic 4',
    cells: [
      { x: 0, y: 0, w: 2 / 3, h: 2 / 3 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 2 / 3 },
      { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 },
      { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
    ],
  },
  {
    id: 'mosaic-5',
    name: 'Mosaic 5',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    ],
  },
];

type Aspect = '1:1' | '4:5' | '16:9' | '9:16' | '3:2';

const ASPECT_RATIOS: Record<Aspect, number> = {
  '1:1': 1.0,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:2': 3 / 2,
};

function getCellPxRect(cell: CellDef, totalW: number, totalH: number, spacing: number) {
  const x0 = cell.x === 0 ? spacing : cell.x * totalW + spacing / 2;
  const y0 = cell.y === 0 ? spacing : cell.y * totalH + spacing / 2;
  const x1 = Math.abs(cell.x + cell.w - 1) < 0.001 ? totalW - spacing : (cell.x + cell.w) * totalW - spacing / 2;
  const y1 = Math.abs(cell.y + cell.h - 1) < 0.001 ? totalH - spacing : (cell.y + cell.h) * totalH - spacing / 2;
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.max(1, Math.round(x1 - x0)),
    h: Math.max(1, Math.round(y1 - y0)),
  };
}

export default function CollageTool() {
  const meta = getToolMeta('img-collage');
  const { t } = useI18n();
  const [photos, setPhotos] = useState<TrayPhoto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('2x2-grid');
  const [aspect, setAspect] = useState<Aspect>('1:1');
  const [spacing, setSpacing] = useState<number>(12);
  const [radius, setRadius] = useState<number>(8);
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [exportLongSide, setExportLongSide] = useState<number>(2048);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg'>('jpg');

  const [cellStates, setCellStates] = useState<CellState[]>(() => new Array(10).fill(null).map(() => ({ zoom: 1.0, panX: 0, panY: 0 })));
  const [activeCellIndex, setActiveCellIndex] = useState<number>(0);

  const [exporting, setExporting] = useState<boolean>(false);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const addFilesInputRef = useRef<HTMLInputElement>(null);

  const isDraggingCellRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number }>({
    clientX: 0,
    clientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const aspectSelectId = useId();
  const longSideSelectId = useId();
  const formatSelectId = useId();

  const currentTemplate = TEMPLATES.find((t) => t.id === selectedTemplateId) || TEMPLATES[7];

  const loadPhotos = async (files: File[]) => {
    setLoadError(null);
    try {
      const newPhotos: TrayPhoto[] = [];
      for (const f of files) {
        const img = await decodeImage(f);
        const thumbUrl = URL.createObjectURL(f);
        newPhotos.push({
          id: `${f.name}-${Date.now()}-${Math.random()}`,
          file: f,
          img,
          thumbUrl,
        });
      }

      setPhotos((prev) => {
        const updated = [...prev, ...newPhotos];
        // Auto assign photos to empty cells
        setCellStates((prevCells) => {
          const next = [...prevCells];
          let photoIndex = 0;
          for (let i = 0; i < currentTemplate.cells.length; i++) {
            if (!next[i]?.photoId && updated[photoIndex]) {
              next[i] = { ...next[i], photoId: updated[photoIndex].id };
              photoIndex++;
            }
          }
          return next;
        });
        return updated;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error decoding photo');
    }
  };

  const removePhoto = (photoId: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (photo) URL.revokeObjectURL(photo.thumbUrl);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setCellStates((prev) => prev.map((c) => (c.photoId === photoId ? { ...c, photoId: undefined } : c)));
  };

  const assignPhotoToCell = (cellIdx: number, photoId: string) => {
    setCellStates((prev) => {
      const next = [...prev];
      next[cellIdx] = {
        ...next[cellIdx],
        photoId,
        zoom: 1.0,
        panX: 0,
        panY: 0,
      };
      return next;
    });
    setActiveCellIndex(cellIdx);
  };

  const renderCollageCanvas = (targetW: number, targetH: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.imageSmoothingQuality = 'high';

    // 1. Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, targetW, targetH);

    // Scaling ratio compared to preview (preview is roughly 600px)
    const scaleRatio = targetW / 600;
    const effSpacing = Math.round(spacing * scaleRatio);
    const effRadius = Math.round(radius * scaleRatio);

    // 2. Draw each cell
    currentTemplate.cells.forEach((cellDef, idx) => {
      const rect = getCellPxRect(cellDef, targetW, targetH, effSpacing);
      const state = cellStates[idx];
      const photo = photos.find((p) => p.id === state?.photoId);

      ctx.save();
      ctx.beginPath();
      if (effRadius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, effRadius);
      } else {
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
      }
      ctx.closePath();
      ctx.clip();

      if (photo) {
        // Draw photo with cover & pan/zoom
        const imgW = photo.img.naturalWidth || photo.img.width || 1;
        const imgH = photo.img.naturalHeight || photo.img.height || 1;
        const baseScale = Math.max(rect.w / imgW, rect.h / imgH);
        const finalScale = baseScale * (state?.zoom || 1.0);
        const drawW = imgW * finalScale;
        const drawH = imgH * finalScale;

        const panScale = scaleRatio;
        const drawX = rect.x + (rect.w - drawW) / 2 + (state?.panX || 0) * panScale;
        const drawY = rect.y + (rect.h - drawH) / 2 + (state?.panY || 0) * panScale;

        ctx.drawImage(photo.img, drawX, drawY, drawW, drawH);
      } else {
        // Placeholder fill for empty cell
        ctx.fillStyle = '#2d3139';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }

      ctx.restore();
    });

    return canvas;
  };

  // Update preview canvas
  useEffect(() => {
    if (photos.length === 0 || !previewCanvasRef.current) return;
    const ratio = ASPECT_RATIOS[aspect];
    let previewW = 600;
    let previewH = Math.round(600 / ratio);
    if (previewH > 500) {
      previewH = 500;
      previewW = Math.round(500 * ratio);
    }

    const canvas = previewCanvasRef.current;
    canvas.width = previewW;
    canvas.height = previewH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rendered = renderCollageCanvas(previewW, previewH);
    ctx.clearRect(0, 0, previewW, previewH);
    ctx.drawImage(rendered, 0, 0);
  }, [photos, currentTemplate, aspect, spacing, radius, bgColor, cellStates]);

  const handlePointerDown = (cellIdx: number, e: React.PointerEvent<HTMLDivElement>) => {
    setActiveCellIndex(cellIdx);
    isDraggingCellRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const st = cellStates[cellIdx] || { zoom: 1.0, panX: 0, panY: 0 };
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPanX: st.panX,
      startPanY: st.panY,
    };
  };

  const handlePointerMove = (cellIdx: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCellRef.current || activeCellIndex !== cellIdx) return;
    const deltaX = e.clientX - dragStartRef.current.clientX;
    const deltaY = e.clientY - dragStartRef.current.clientY;

    setCellStates((prev) => {
      const next = [...prev];
      next[cellIdx] = {
        ...next[cellIdx],
        panX: Math.round(dragStartRef.current.startPanX + deltaX),
        panY: Math.round(dragStartRef.current.startPanY + deltaY),
      };
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingCellRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  const handleCellWheel = (cellIdx: number, e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setCellStates((prev) => {
      const next = [...prev];
      const curZoom = next[cellIdx]?.zoom || 1.0;
      next[cellIdx] = {
        ...next[cellIdx],
        zoom: Math.min(3.5, Math.max(0.5, Number((curZoom + delta).toFixed(2)))),
      };
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    setLoadError(null);
    try {
      const ratio = ASPECT_RATIOS[aspect];
      let fullW: number;
      let fullH: number;

      if (ratio >= 1.0) {
        fullW = exportLongSide;
        fullH = Math.round(exportLongSide / ratio);
      } else {
        fullH = exportLongSide;
        fullW = Math.round(exportLongSide * ratio);
      }

      const canvas = renderCollageCanvas(fullW, fullH);
      const mime: EncodableMime = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
      const quality = exportFormat === 'png' ? undefined : 0.92;
      const blob = await canvasToBlob(canvas, mime, quality);

      setResult({ blob, filename: `collage-${fullW}x${fullH}.${exportFormat}` });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    setPhotos([]);
    setResult(null);
    setLoadError(null);
    setCellStates(new Array(10).fill(null).map(() => ({ zoom: 1.0, panX: 0, panY: 0 })));
  };

  if (result) {
    return (
      <ToolPage title={meta.title} description={meta.description} currentId="img-collage">
        <ResultPanel blob={result.blob} filename={result.filename} kind="image" onReset={() => setResult(null)} />
      </ToolPage>
    );
  }

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-collage">
      {photos.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label={t('Choose photos for your collage')}
          hint={t('Supports JPG, PNG, WebP, HEIC and SVG. Includes over 10 templates, pan and zoom per cell, and export up to 4096 px.')}
          onFiles={loadPhotos}
        />
      ) : (
        <div className={styles.wrapper}>
          {loadError && <div className="error-banner">{t(loadError)}</div>}

          {/* Photo Tray */}
          <div className={styles.traySection}>
            <div className={styles.trayHeader}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {t('Photo tray ({count}) — Drag photos onto cells below:', { count: photos.length })}
              </h3>
              <input
                ref={addFilesInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) loadPhotos(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                onClick={() => addFilesInputRef.current?.click()}
              >
                {t('+ Add more photos')}
              </Button>
            </div>
            <div className={styles.photoTray}>
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={styles.trayPhoto}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', p.id);
                  }}
                  title={t('Drag this photo onto any cell below')}
                >
                  <img src={p.thumbUrl} alt="" className={styles.trayPhotoImg} />
                  <button
                    type="button"
                    className={styles.trayRemoveBtn}
                    onClick={() => removePhoto(p.id)}
                    title={t('Remove from tray')}
                    aria-label={t('Remove from tray')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Stage Area */}
          <div className={styles.editorArea}>
            <div className={styles.stageBox}>
              <div className={styles.stageCanvasWrapper} style={{ aspectRatio: `${ASPECT_RATIOS[aspect]}` }}>
                <canvas ref={previewCanvasRef} className={styles.previewCanvas} />

                {/* Interactive Cell Overlay for dragging and cell selection */}
                <div className={styles.cellOverlayLayer}>
                  {currentTemplate.cells.map((cellDef, idx) => {
                    const st = cellStates[idx];
                    const hasPhoto = !!st?.photoId;
                    return (
                      <div
                        key={idx}
                        className={`${styles.interactiveCell} ${activeCellIndex === idx ? styles.interactiveCellActive : ''}`}
                        style={{
                          left: `${cellDef.x * 100}%`,
                          top: `${cellDef.y * 100}%`,
                          width: `${cellDef.w * 100}%`,
                          height: `${cellDef.h * 100}%`,
                        }}
                        onPointerDown={(e) => handlePointerDown(idx, e)}
                        onPointerMove={(e) => handlePointerMove(idx, e)}
                        onPointerUp={handlePointerUp}
                        onWheel={(e) => handleCellWheel(idx, e)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const photoId = e.dataTransfer.getData('text/plain');
                          if (photoId) assignPhotoToCell(idx, photoId);
                        }}
                        title={hasPhoto ? t('Drag to pan, mouse wheel to zoom') : t('Drop photo here')}
                      >
                        {!hasPhoto && <div className={styles.emptyCellBadge}>{t('+ Drop photo')}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Active Cell Pan/Zoom Controls */}
            {cellStates[activeCellIndex]?.photoId && (
              <div style={{ width: '100%', maxWidth: '650px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa' }}>
                  {t('Cell {number} zoom:', { number: activeCellIndex + 1 })}
                </span>
                <div style={{ flex: 1 }}>
                  <Slider
                    value={cellStates[activeCellIndex]?.zoom || 1.0}
                    min={0.5}
                    max={3.0}
                    step={0.05}
                    unit="x"
                    onChange={(z) =>
                      setCellStates((prev) => {
                        const next = [...prev];
                        next[activeCellIndex] = { ...next[activeCellIndex], zoom: z };
                        return next;
                      })
                    }
                  />
                </div>
                <Button
                  variant="secondary"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                  onClick={() =>
                    setCellStates((prev) => {
                      const next = [...prev];
                      next[activeCellIndex] = {
                        ...next[activeCellIndex],
                        zoom: 1.0,
                        panX: 0,
                        panY: 0,
                      };
                      return next;
                    })
                  }
                >
                  {t('Reset cell')}
                </Button>
              </div>
            )}
          </div>

          {/* Templates Selection (12 templates) */}
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('Choose a template (12 options)')}</h3>
            <div className={styles.templateGrid}>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`${styles.templateBtn} ${selectedTemplateId === tpl.id ? styles.templateBtnActive : ''}`}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                >
                  <div className={styles.templateMiniIcon}>
                    {tpl.cells.map((c, i) => (
                      <div
                        key={i}
                        className={styles.templateMiniCell}
                        style={{
                          left: `${c.x * 100}%`,
                          top: `${c.y * 100}%`,
                          width: `${c.w * 100}%`,
                          height: `${c.h * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <span>{t(tpl.name)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Customization Controls */}
          <div className={styles.controlsGrid}>
            <Field label={t('Aspect ratio')} hint={t('Overall shape of the collage.')}>
              <Select
                id={aspectSelectId}
                value={aspect}
                onChange={(e) => setAspect(e.target.value as Aspect)}
                options={[
                  { value: '1:1', label: t('1:1 (Square — Instagram post)') },
                  { value: '4:5', label: t('4:5 (Portrait — Instagram post)') },
                  { value: '16:9', label: t('16:9 (Landscape — YouTube / web)') },
                  { value: '9:16', label: t('9:16 (Story / Reels / TikTok)') },
                  { value: '3:2', label: t('3:2 (Classic 35 mm photo)') },
                ]}
              />
            </Field>

            <Field label={t('Cell spacing (px)')} hint={t('Gap distance between photos.')}>
              <Slider value={spacing} min={0} max={40} step={2} unit="px" onChange={setSpacing} />
            </Field>

            <Field label={t('Corner roundness (px)')} hint={t('Rounds the edges of each photo.')}>
              <Slider value={radius} min={0} max={40} step={2} unit="px" onChange={setRadius} />
            </Field>

            <Field label={t('Background colour')} hint={t('Colour shown in the spacing gaps.')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  style={{ width: '38px', height: '38px', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                />
                <span style={{ fontSize: '0.85rem' }}>{bgColor}</span>
              </div>
            </Field>

            <Field label={t('Export resolution')} hint={t('Longest side in pixels.')}>
              <Select
                id={longSideSelectId}
                value={String(exportLongSide)}
                onChange={(e) => setExportLongSide(parseInt(e.target.value, 10))}
                options={[
                  { value: '1080', label: t('1080 px (Social / fast)') },
                  { value: '2048', label: t('2048 px (High definition — recommended)') },
                  { value: '4096', label: t('4096 px (Ultra HD / print)') },
                ]}
              />
            </Field>

            <Field label={t('Export format')} hint={t('JPG is recommended for photos.')}>
              <Select
                id={formatSelectId}
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'jpg' | 'png')}
                options={[
                  { value: 'jpg', label: t('JPEG (quality 92)') },
                  { value: 'png', label: t('PNG') },
                ]}
              />
            </Field>
          </div>

          <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
            <Button variant="secondary" onClick={handleReset}>
              {t('Start over')}
            </Button>
            <Button variant="primary" onClick={handleExport} disabled={exporting}>
              {exporting ? t('Generating collage…') : t('Export collage ({width}px)', { width: exportLongSide })}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
