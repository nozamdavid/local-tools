import { useEffect, useRef, useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { ResultPanel } from '../../../components/ResultPanel';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { IMAGE_ACCEPT, decodeImage, canvasToBlob, type EncodableMime } from '../../../lib/image';
import { withSuffix } from '../../../lib/format';
import styles from './Tool.module.css';

interface ImageItem {
  id: string;
  file: File;
  img: HTMLImageElement;
  width: number;
  height: number;
  thumbUrl: string;
}

type Direction = 'horizontal' | 'vertical' | 'grid';
type Alignment = 'start' | 'center' | 'end';
type Format = 'png' | 'jpg' | 'webp';

export default function MergeTool() {
  const meta = getToolMeta('img-merge');
  const { t } = useI18n();
  const [items, setItems] = useState<ImageItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction>('horizontal');
  const [gridCols, setGridCols] = useState<number>(2);
  const [alignment, setAlignment] = useState<Alignment>('center');
  const [matchSize, setMatchSize] = useState<boolean>(true);
  const [gap, setGap] = useState<number>(0);
  const [isTransparent, setIsTransparent] = useState<boolean>(false);
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [format, setFormat] = useState<Format>('png');

  const [exporting, setExporting] = useState<boolean>(false);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const addFilesInputRef = useRef<HTMLInputElement>(null);

  const directionId = useId();
  const alignmentId = useId();
  const formatId = useId();
  const gridColsId = useId();

  const loadFiles = async (files: File[]) => {
    setLoadError(null);
    try {
      const newItems: ImageItem[] = [];
      for (const file of files) {
        const img = await decodeImage(file);
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const thumbUrl = URL.createObjectURL(file);
        newItems.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          img,
          width: w,
          height: h,
          thumbUrl,
        });
      }
      setItems((prev) => [...prev, ...newItems]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error decoding image');
    }
  };

  const handleRemove = (index: number) => {
    URL.revokeObjectURL(items[index].thumbUrl);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMove = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const buildCanvas = (): HTMLCanvasElement => {
    if (items.length === 0) throw new Error('No images to merge');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.imageSmoothingQuality = 'high';

    if (direction === 'horizontal') {
      const maxH = Math.max(...items.map((it) => it.height));
      const targetH = matchSize ? maxH : maxH;

      const layout = items.map((it) => {
        const scale = matchSize ? targetH / it.height : 1;
        const w = Math.round(it.width * scale);
        const h = Math.round(it.height * scale);
        return { it, w, h };
      });

      const totalW = layout.reduce((acc, curr) => acc + curr.w, 0) + gap * (items.length - 1);
      const totalH = targetH;

      canvas.width = Math.max(1, totalW);
      canvas.height = Math.max(1, totalH);

      if (!isTransparent || format === 'jpg') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      let curX = 0;
      for (const { it, w, h } of layout) {
        let curY = 0;
        if (!matchSize) {
          if (alignment === 'center') curY = Math.round((totalH - h) / 2);
          else if (alignment === 'end') curY = totalH - h;
        }
        ctx.drawImage(it.img, curX, curY, w, h);
        curX += w + gap;
      }
    } else if (direction === 'vertical') {
      const maxW = Math.max(...items.map((it) => it.width));
      const targetW = matchSize ? maxW : maxW;

      const layout = items.map((it) => {
        const scale = matchSize ? targetW / it.width : 1;
        const w = Math.round(it.width * scale);
        const h = Math.round(it.height * scale);
        return { it, w, h };
      });

      const totalW = targetW;
      const totalH = layout.reduce((acc, curr) => acc + curr.h, 0) + gap * (items.length - 1);

      canvas.width = Math.max(1, totalW);
      canvas.height = Math.max(1, totalH);

      if (!isTransparent || format === 'jpg') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      let curY = 0;
      for (const { it, w, h } of layout) {
        let curX = 0;
        if (!matchSize) {
          if (alignment === 'center') curX = Math.round((totalW - w) / 2);
          else if (alignment === 'end') curX = totalW - w;
        }
        ctx.drawImage(it.img, curX, curY, w, h);
        curY += h + gap;
      }
    } else {
      // Grid
      const cols = Math.max(1, Math.min(items.length, gridCols));
      const rows = Math.ceil(items.length / cols);

      const maxW = Math.max(...items.map((it) => it.width));
      const maxH = Math.max(...items.map((it) => it.height));

      // Calculate column widths and row heights
      const colWidths = new Array(cols).fill(matchSize ? maxW : 0);
      const rowHeights = new Array(rows).fill(matchSize ? maxH : 0);

      if (!matchSize) {
        items.forEach((it, idx) => {
          const c = idx % cols;
          const r = Math.floor(idx / cols);
          colWidths[c] = Math.max(colWidths[c], it.width);
          rowHeights[r] = Math.max(rowHeights[r], it.height);
        });
      }

      const totalW = colWidths.reduce((a, b) => a + b, 0) + gap * (cols - 1);
      const totalH = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows - 1);

      canvas.width = Math.max(1, totalW);
      canvas.height = Math.max(1, totalH);

      if (!isTransparent || format === 'jpg') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      items.forEach((it, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);

        let cellX = 0;
        for (let i = 0; i < c; i++) cellX += colWidths[i] + gap;
        let cellY = 0;
        for (let i = 0; i < r; i++) cellY += rowHeights[i] + gap;

        const cellW = colWidths[c];
        const cellH = rowHeights[r];

        if (matchSize) {
          // Fit inside cell preserving aspect ratio
          const scale = Math.min(cellW / it.width, cellH / it.height);
          const w = Math.round(it.width * scale);
          const h = Math.round(it.height * scale);
          const x = cellX + Math.round((cellW - w) / 2);
          const y = cellY + Math.round((cellH - h) / 2);
          ctx.drawImage(it.img, x, y, w, h);
        } else {
          let x = cellX;
          let y = cellY;
          if (alignment === 'center') {
            x = cellX + Math.round((cellW - it.width) / 2);
            y = cellY + Math.round((cellH - it.height) / 2);
          } else if (alignment === 'end') {
            x = cellX + cellW - it.width;
            y = cellY + cellH - it.height;
          }
          ctx.drawImage(it.img, x, y, it.width, it.height);
        }
      });
    }

    return canvas;
  };

  // Update preview canvas
  useEffect(() => {
    if (items.length < 1 || !canvasRef.current) return;
    try {
      const merged = buildCanvas();
      const preview = canvasRef.current;
      preview.width = merged.width;
      preview.height = merged.height;
      const ctx = preview.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, preview.width, preview.height);
        ctx.drawImage(merged, 0, 0);
      }
    } catch {
      // Ignore preview errors during edits
    }
  }, [items, direction, gridCols, alignment, matchSize, gap, isTransparent, bgColor, format]);

  const handleExport = async () => {
    if (items.length < 2) return;
    setExporting(true);
    setLoadError(null);
    try {
      const merged = buildCanvas();
      const mime: EncodableMime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const quality = format === 'png' ? undefined : 0.92;
      const blob = await canvasToBlob(merged, mime, quality);

      const baseName = items[0]?.file.name || 'merged-image';
      const filename = withSuffix(baseName, '-merged', format);
      setResult({ blob, filename });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    items.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
    setItems([]);
    setResult(null);
    setLoadError(null);
  };

  if (result) {
    return (
      <ToolPage title={meta.title} description={meta.description} currentId="img-merge">
        <ResultPanel blob={result.blob} filename={result.filename} kind="image" onReset={() => setResult(null)} />
      </ToolPage>
    );
  }

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-merge">
      {items.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label={t('Choose 2 or more images to combine')}
          hint={t('Supports JPG, PNG, WebP, HEIC and SVG. Merge horizontally, vertically or in a grid.')}
          onFiles={loadFiles}
        />
      ) : (
        <div className={styles.wrapper}>
          {loadError && <div className="error-banner">{t(loadError)}</div>}

          {/* Image List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{t('Images ({count})', { count: items.length })}</h3>
              <input
                ref={addFilesInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) loadFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" style={{ fontSize: '0.85rem' }} onClick={() => addFilesInputRef.current?.click()}>
                {t('+ Add more images')}
              </Button>
            </div>

            <div className={styles.imageList}>
              {items.map((it, idx) => (
                <div key={it.id} className={styles.imageItem}>
                  <div className={styles.itemLeft}>
                    <img src={it.thumbUrl} alt="" className={styles.itemThumb} />
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName} title={it.file.name}>
                        {it.file.name}
                      </span>
                      <span className={styles.itemMeta}>
                        {it.width} × {it.height} px
                      </span>
                    </div>
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, -1)}
                      title={t('Move up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={idx === items.length - 1}
                      onClick={() => handleMove(idx, 1)}
                      title={t('Move down')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => handleRemove(idx)}
                      title={t('Remove')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Merge Preview */}
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('Live preview')}</h3>
            <div className={styles.previewContainer}>
              <canvas ref={canvasRef} className={styles.previewCanvas} role="img" aria-label={t('Preview of the merged image')} />
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
            <Field label={t('Direction')} hint={t('How images are sequenced together.')}>
              <Select
                id={directionId}
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
                options={[
                  { value: 'horizontal', label: t('Horizontal (side by side)') },
                  { value: 'vertical', label: t('Vertical (stacked)') },
                  { value: 'grid', label: t('Grid') },
                ]}
              />
            </Field>

            {direction === 'grid' && (
              <Field label={t('Grid columns')} hint={t('Number of columns in the grid.')}>
                <Select
                  id={gridColsId}
                  value={String(gridCols)}
                  onChange={(e) => setGridCols(parseInt(e.target.value, 10))}
                  options={[
                    { value: '2', label: t('2 columns') },
                    { value: '3', label: t('3 columns') },
                    { value: '4', label: t('4 columns') },
                    { value: '5', label: t('5 columns') },
                  ]}
                />
              </Field>
            )}

            <Field label={t('Alignment')} hint={t('Alignment for differently sized images.')}>
              <Select
                id={alignmentId}
                value={alignment}
                disabled={matchSize && direction !== 'grid'}
                onChange={(e) => setAlignment(e.target.value as Alignment)}
                options={[
                  { value: 'center', label: t('Center (recommended)') },
                  { value: 'start', label: direction === 'vertical' ? t('Left') : t('Top') },
                  { value: 'end', label: direction === 'vertical' ? t('Right') : t('Bottom') },
                ]}
              />
            </Field>

            <Field label={t('Spacing / gap (px)')} hint={t('Space between adjacent images.')}>
              <Slider value={gap} min={0} max={100} step={2} unit="px" onChange={setGap} />
            </Field>

            <Field label={t('Output format')} hint={t('PNG preserves transparency; JPG produces smaller files.')}>
              <Select
                id={formatId}
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                options={[
                  { value: 'png', label: t('PNG') },
                  { value: 'jpg', label: t('JPG') },
                  { value: 'webp', label: t('WebP') },
                ]}
              />
            </Field>

            <Field label={t('Background and gap colour')} hint={t('Colour filled between and behind images.')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="color"
                  value={bgColor}
                  disabled={isTransparent && format !== 'jpg'}
                  onChange={(e) => setBgColor(e.target.value)}
                  style={{ width: '38px', height: '38px', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                />
                {format !== 'jpg' && (
                  <label className="checkbox-label" style={{ margin: 0 }}>
                    <input type="checkbox" checked={isTransparent} onChange={(e) => setIsTransparent(e.target.checked)} />
                    <span>{t('Transparent')}</span>
                  </label>
                )}
              </div>
            </Field>
          </div>

          <div className="field">
            <label className="checkbox-label">
              <input type="checkbox" checked={matchSize} onChange={(e) => setMatchSize(e.target.checked)} />
              <span>{t('Match size (scale all images to uniform height for horizontal, or uniform width for vertical)')}</span>
            </label>
          </div>

          <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
            <Button variant="secondary" onClick={handleReset}>
              {t('Start over')}
            </Button>
            <Button variant="primary" onClick={handleExport} disabled={exporting || items.length < 2}>
              {exporting ? t('Merging…') : t('Merge {count} images', { count: items.length })}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
