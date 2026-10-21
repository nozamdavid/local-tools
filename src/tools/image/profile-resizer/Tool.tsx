import { useEffect, useRef, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Slider, Button } from '../../../components/Controls';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT, decodeImage, canvasToBlob } from '../../../lib/image';
import { zipFiles } from '../../../lib/zip';
import { downloadBlob } from '../../../lib/download';
import styles from './Tool.module.css';

interface AvatarPreset {
  id: string;
  name: string;
  filename: string;
  width: number;
  height: number;
  shape: 'circle' | 'square';
}

const PRESETS: AvatarPreset[] = [
  { id: 'instagram', name: 'Instagram', filename: 'instagram-320x320.png', width: 320, height: 320, shape: 'circle' },
  { id: 'facebook', name: 'Facebook', filename: 'facebook-170x170.png', width: 170, height: 170, shape: 'circle' },
  { id: 'twitter', name: 'X / Twitter', filename: 'twitter-400x400.png', width: 400, height: 400, shape: 'circle' },
  { id: 'linkedin', name: 'LinkedIn', filename: 'linkedin-400x400.png', width: 400, height: 400, shape: 'circle' },
  { id: 'youtube', name: 'YouTube', filename: 'youtube-800x800.png', width: 800, height: 800, shape: 'circle' },
  { id: 'tiktok', name: 'TikTok', filename: 'tiktok-200x200.png', width: 200, height: 200, shape: 'circle' },
  { id: 'discord', name: 'Discord', filename: 'discord-128x128.png', width: 128, height: 128, shape: 'circle' },
  { id: 'slack', name: 'Slack', filename: 'slack-512x512.png', width: 512, height: 512, shape: 'square' },
  { id: 'github', name: 'GitHub', filename: 'github-460x460.png', width: 460, height: 460, shape: 'circle' },
  { id: 'whatsapp', name: 'WhatsApp', filename: 'whatsapp-500x500.png', width: 500, height: 500, shape: 'circle' },
];

const REF_SIZE = 800;

export default function ProfileResizerTool() {
  const meta = getToolMeta('img-profile-resizer');
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [previewShape, setPreviewShape] = useState<'circle' | 'square'>('circle');

  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  const [batchItems, setBatchItems] = useState<BatchResultItem[] | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number }>({
    clientX: 0,
    clientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const handleFiles = (files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setBatchItems(null);
    }
  };

  useEffect(() => {
    if (!file) {
      setImg(null);
      return;
    }
    let active = true;
    decodeImage(file)
      .then((loaded) => {
        if (!active) return;
        setImg(loaded);
        setLoadError(null);
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Could not decode image');
      });
    return () => {
      active = false;
    };
  }, [file]);

  const drawAvatarToCanvas = (
    targetSize: number,
    sourceImg: HTMLImageElement,
    currentPan: { x: number; y: number },
    currentZoom: number,
  ): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.imageSmoothingQuality = 'high';

    const imgW = sourceImg.naturalWidth || sourceImg.width || 1;
    const imgH = sourceImg.naturalHeight || sourceImg.height || 1;

    // Cover square
    const baseScale = Math.max(targetSize / imgW, targetSize / imgH);
    const finalScale = baseScale * Math.max(0.1, currentZoom);
    const drawW = imgW * finalScale;
    const drawH = imgH * finalScale;

    const scaleFactor = targetSize / REF_SIZE;
    const drawX = (targetSize - drawW) / 2 + currentPan.x * scaleFactor;
    const drawY = (targetSize - drawH) / 2 + currentPan.y * scaleFactor;

    ctx.drawImage(sourceImg, drawX, drawY, drawW, drawH);
    return canvas;
  };

  // Update editor canvas & preview data URL
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rendered = drawAvatarToCanvas(320, img, pan, zoom);
    ctx.clearRect(0, 0, 320, 320);
    ctx.drawImage(rendered, 0, 0);

    setPreviewDataUrl(canvas.toDataURL('image/png'));
  }, [img, pan, zoom]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const factor = REF_SIZE / rect.width;
    const deltaX = (e.clientX - dragStartRef.current.clientX) * factor;
    const deltaY = (e.clientY - dragStartRef.current.clientY) * factor;

    setPan({
      x: Math.round(dragStartRef.current.startPanX + deltaX),
      y: Math.round(dragStartRef.current.startPanY + deltaY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setZoom((prev) => Math.min(3.5, Math.max(0.5, Number((prev + delta).toFixed(2)))));
  };

  const handleExportAll = async () => {
    if (!img) return;
    setExporting(true);
    try {
      const items: { name: string; blob: Blob }[] = [];

      for (const preset of PRESETS) {
        const c = drawAvatarToCanvas(preset.width, img, pan, zoom);
        const blob = await canvasToBlob(c, 'image/png');
        items.push({ name: preset.filename, blob });
      }

      // Generate ZIP and trigger automatic download
      const zip = await zipFiles(items);
      downloadBlob(zip, 'loconvert-avatars.zip');

      setBatchItems(items.map((it) => ({ name: it.name, blob: it.blob, originalSize: file?.size })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-profile-resizer">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose a profile photo or avatar"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Positions once and exports all 10 platform sizes."
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.wrapper}>
          {loadError && <div className="error-banner">{loadError}</div>}

          {batchItems ? (
            <div>
              <div style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
                Your avatar ZIP has been generated! You can also download each avatar size individually below:
              </div>
              <BatchResults
                items={batchItems}
                onReset={() => {
                  setBatchItems(null);
                }}
              />
            </div>
          ) : (
            <div className={styles.editorArea}>
              <div className="meta-chips">
                <span className="meta-chip">
                  Original: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Presets: <strong>10 social platforms</strong>
                </span>
                <span className="meta-chip">
                  Format: <strong>PNG</strong>
                </span>
              </div>

              {/* Editor preview canvas */}
              <div className={styles.canvasBox}>
                <div
                  className={`${styles.canvasInner} ${previewShape === 'circle' ? styles.circle : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onWheel={handleWheel}
                  onKeyDown={(e) => {
                    // Keyboard equivalent of dragging: arrows move the photo (Shift for larger steps).
                    const step = e.shiftKey ? 50 : 10;
                    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
                    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
                    if (!dx && !dy) return;
                    e.preventDefault();
                    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
                  }}
                  tabIndex={0}
                  role="group"
                  aria-label="Photo position. Arrow keys move the photo (Shift for larger steps). Use the Zoom slider to zoom."
                  title="Drag to position photo, mouse wheel to zoom"
                >
                  <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="Preview of the cropped profile picture" />
                  {previewShape === 'square' && <div className={styles.circleOverlay} />}
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                <Field label="Zoom" hint="Drag avatar to center; slide to zoom.">
                  <Slider value={zoom} min={0.5} max={3.0} step={0.05} unit="x" onChange={setZoom} />
                  <div style={{ marginTop: '0.5rem' }}>
                    <Button
                      type="button"
                      variant="secondary"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                      onClick={() => {
                        setZoom(1.0);
                        setPan({ x: 0, y: 0 });
                      }}
                    >
                      Reset position
                    </Button>
                  </div>
                </Field>

                <Field label="Preview style" hint="Toggle how avatars are displayed in the preview below.">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      type="button"
                      variant={previewShape === 'circle' ? 'primary' : 'secondary'}
                      onClick={() => setPreviewShape('circle')}
                    >
                      Circular preview
                    </Button>
                    <Button
                      type="button"
                      variant={previewShape === 'square' ? 'primary' : 'secondary'}
                      onClick={() => setPreviewShape('square')}
                    >
                      Square preview
                    </Button>
                  </div>
                </Field>
              </div>

              {/* Preview Grid */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginTop: '1rem', marginBottom: '0.5rem' }}>
                  Live Preview across 10 Platforms:
                </h3>
                <div className={styles.previewGrid}>
                  {PRESETS.map((preset) => (
                    <div key={preset.id} className={styles.previewCard}>
                      <div className={styles.cardTitle}>{preset.name}</div>
                      <div className={styles.cardDimensions}>
                        {preset.width} × {preset.height} px
                      </div>
                      <div className={styles.thumbContainer}>
                        {previewDataUrl ? (
                          <img
                            src={previewDataUrl}
                            alt={preset.name}
                            className={`${styles.cardThumb} ${previewShape === 'circle' ? styles.thumbCircle : styles.thumbSquare}`}
                          />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                <Button variant="secondary" onClick={() => setFile(null)}>
                  Choose different photo
                </Button>
                <Button variant="primary" onClick={handleExportAll} disabled={exporting}>
                  {exporting ? 'Exporting ZIP…' : 'Export all 10 avatars (.zip)'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
