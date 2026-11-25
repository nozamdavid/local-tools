import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage } from '../../../lib/image';
import {
  type RGBA,
  formatHex,
  formatRgb,
  formatHsl,
  formatHsv,
  formatCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToCmyk,
  parseHex,
} from '../_color/convert';
import styles from './Tool.module.css';

interface ColorEntry {
  rgba: RGBA;
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  cmyk: string;
}

function makeColorEntry(rgba: RGBA): ColorEntry {
  const hsla = rgbToHsl(rgba);
  const hsva = rgbToHsv(rgba);
  const cmyk = rgbToCmyk(rgba);
  return {
    rgba,
    hex: formatHex(rgba, 6),
    rgb: formatRgb(rgba),
    hsl: formatHsl(hsla),
    hsv: formatHsv(hsva),
    cmyk: formatCmyk(cmyk),
  };
}

export default function ColorPickerTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-color-picker');
  const [file, setFile] = useState<File | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [loupePos, setLoupePos] = useState<{ x: number; y: number } | null>(null);
  const [hoverColor, setHoverColor] = useState<ColorEntry | null>(null);

  const [selectedColor, setSelectedColor] = useState<ColorEntry | null>(null);
  const [history, setHistory] = useState<ColorEntry[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    try {
      const selected = files[0];
      const img = await decodeImage(selected);
      setFile(selected);
      setImgElement(img);

      // Setup offscreen canvas with full resolution
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(t('Canvas 2D unavailable'));
      ctx.drawImage(img, 0, 0);

      offscreenCanvasRef.current = canvas;
      offscreenCtxRef.current = ctx;

      // Sample center pixel as initial selection
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const pixel = ctx.getImageData(cx, cy, 1, 1).data;
      const initialEntry = makeColorEntry({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2],
        a: pixel[3] / 255,
      });
      setSelectedColor(initialEntry);
      setHistory([initialEntry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image');
    }
  };

  const handleReset = () => {
    setFile(null);
    setImgElement(null);
    setHoverPos(null);
    setHoverColor(null);
    offscreenCanvasRef.current = null;
    offscreenCtxRef.current = null;
  };

  const pickColorAt = useCallback((x: number, y: number) => {
    const ctx = offscreenCtxRef.current;
    const canvas = offscreenCanvasRef.current;
    if (!ctx || !canvas) return;

    const clampedX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));

    const pixel = ctx.getImageData(clampedX, clampedY, 1, 1).data;
    const entry = makeColorEntry({
      r: pixel[0],
      g: pixel[1],
      b: pixel[2],
      a: pixel[3] / 255,
    });

    setSelectedColor(entry);
    setHistory((prev) => {
      const filtered = prev.filter((item) => item.hex !== entry.hex);
      return [entry, ...filtered].slice(0, 24);
    });
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    const ctx = offscreenCtxRef.current;
    const canvas = offscreenCanvasRef.current;
    if (!img || !ctx || !canvas) return;

    const rect = img.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    if (clientX < 0 || clientX > rect.width || clientY < 0 || clientY > rect.height) {
      setHoverPos(null);
      return;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const imgX = clientX * scaleX;
    const imgY = clientY * scaleY;

    setLoupePos({ x: clientX, y: clientY });
    setHoverPos({ x: imgX, y: imgY });

    const pixel = ctx.getImageData(Math.floor(imgX), Math.floor(imgY), 1, 1).data;
    setHoverColor(
      makeColorEntry({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2],
        a: pixel[3] / 255,
      }),
    );
  };

  const handleMouseLeave = () => {
    setHoverPos(null);
    setHoverColor(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    const canvas = offscreenCanvasRef.current;
    if (!img || !canvas) return;

    const rect = img.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    pickColorAt(clientX * scaleX, clientY * scaleY);
  };

  // Render loupe content whenever hoverPos changes
  useEffect(() => {
    if (!hoverPos || !offscreenCtxRef.current || !loupeCanvasRef.current) return;

    const lCanvas = loupeCanvasRef.current;
    const lCtx = lCanvas.getContext('2d');
    if (!lCtx) return;

    const sampleRadius = 5; // 11x11 grid
    const sampleSize = sampleRadius * 2 + 1;
    lCanvas.width = sampleSize;
    lCanvas.height = sampleSize;

    const sx = Math.floor(hoverPos.x) - sampleRadius;
    const sy = Math.floor(hoverPos.y) - sampleRadius;

    lCtx.clearRect(0, 0, sampleSize, sampleSize);
    lCtx.drawImage(offscreenCanvasRef.current!, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
  }, [hoverPos]);

  const handleEyeDropper = async () => {
    if (!hasEyeDropper) return;
    try {
      // @ts-expect-error EyeDropper is experimental browser API
      const eyeDropper = new window.EyeDropper();
      const res = await eyeDropper.open();
      if (res && res.sRGBHex) {
        const rgba = parseHex(res.sRGBHex);
        if (rgba) {
          const entry = makeColorEntry(rgba);
          setSelectedColor(entry);
          setHistory((prev) => {
            const filtered = prev.filter((item) => item.hex !== entry.hex);
            return [entry, ...filtered].slice(0, 24);
          });
        }
      }
    } catch {
      // EyeDropper cancelled or dismissed by user
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-color-picker">
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div>
            {hasEyeDropper && (
              <Button variant="secondary" onClick={handleEyeDropper}>
                🔍 {t('Pick from screen')}
              </Button>
            )}
          </div>
          {file && (
            <Button variant="secondary" onClick={handleReset}>
              {t('Choose different image')}
            </Button>
          )}
        </div>

        {error && <div className="error-banner">{t(error)}</div>}

        {!file ? (
          <FileDrop
            accept="image/*"
            label={t('Drop an image here to pick colours')}
            hint={t('Supports JPG, PNG, WEBP, SVG, HEIC and more.')}
            onFiles={handleFiles}
          />
        ) : (
          <>
            <div className={styles.imageWrapper} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}>
              <img
                ref={imgRef}
                src={imgElement ? imgElement.src : undefined}
                alt={t('Source for color picking')}
                className={styles.imageDisplay}
              />

              {hoverPos && loupePos && (
                <div className={styles.loupe} style={{ left: `${loupePos.x}px`, top: `${loupePos.y}px` }}>
                  <canvas ref={loupeCanvasRef} className={styles.loupeCanvas} aria-hidden="true" />
                  <div className={styles.loupeCrosshair} />
                  {hoverColor && <div className={styles.loupeBadge}>{hoverColor.hex.toUpperCase()}</div>}
                </div>
              )}
            </div>

            {selectedColor && (
              <div className={styles.detailsGrid}>
                <div className={styles.swatchCard}>
                  <div className={styles.swatchPreview} style={{ backgroundColor: selectedColor.hex }} />
                  <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{selectedColor.hex.toUpperCase()}</div>
                </div>

                <div className={styles.valuesList}>
                  {(
                    [
                      { label: 'HEX', val: selectedColor.hex.toUpperCase(), key: 'hex' },
                      { label: 'RGB', val: selectedColor.rgb, key: 'rgb' },
                      { label: 'HSL', val: selectedColor.hsl, key: 'hsl' },
                      { label: 'HSV', val: selectedColor.hsv, key: 'hsv' },
                      { label: 'CMYK', val: selectedColor.cmyk, key: 'cmyk' },
                    ] as const
                  ).map((item) => (
                    <div key={item.key} className={styles.valueRow}>
                      <span className={styles.valueLabel}>{item.label}</span>
                      <span className={styles.valueText}>{item.val}</span>
                      <Button
                        variant="secondary"
                        onClick={() => copyToClipboard(item.val, item.key)}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                      >
                        {copiedKey === item.key ? t('Copied!') : t('Copy')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className={styles.historySection}>
                <div className={styles.historyTitle}>
                  <span>{t('Pick history ({count})', { count: history.length })}</span>
                  <Button variant="secondary" onClick={() => setHistory([])} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                    {t('Clear history')}
                  </Button>
                </div>
                <div className={styles.historySwatches}>
                  {history.map((c, idx) => (
                    <div
                      key={`${c.hex}-${idx}`}
                      className={`${styles.historySwatch} ${selectedColor?.hex === c.hex ? styles.selected : ''}`}
                      style={{ backgroundColor: c.hex }}
                      title={t('{color} - click to inspect', { color: c.hex })}
                      onClick={() => setSelectedColor(c)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ToolPage>
  );
}
