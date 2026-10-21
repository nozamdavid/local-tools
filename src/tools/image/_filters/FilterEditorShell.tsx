import React, { useState, useEffect, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, imageToCanvas, canvasToBlob, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { formatBytes, withSuffix } from '../../../lib/format';
import { hasAlphaChannel, createPreviewCanvas } from './common';
import styles from './FilterEditorShell.module.css';

export interface FilterEditorShellProps<T> {
  toolId: string;
  defaultOptions: T;
  suffix: string;
  defaultFormat?: EncodableMime;
  render: (sourceCanvas: HTMLCanvasElement, options: T, isPreview: boolean) => Promise<HTMLCanvasElement> | HTMLCanvasElement;
  renderControls: (
    options: T,
    setOptions: React.Dispatch<React.SetStateAction<T>>,
    meta: {
      imageWidth: number;
      imageHeight: number;
      previewCanvas: HTMLCanvasElement | null;
      previewContainerRef: React.RefObject<HTMLDivElement | null>;
    },
  ) => React.ReactNode;
  renderOverlay?: (
    options: T,
    setOptions: React.Dispatch<React.SetStateAction<T>>,
    meta: {
      imageWidth: number;
      imageHeight: number;
      previewWidth: number;
      previewHeight: number;
    },
  ) => React.ReactNode;
}

export function FilterEditorShell<T>({
  toolId,
  defaultOptions,
  suffix,
  defaultFormat: forcedDefaultFormat,
  render,
  renderControls,
  renderOverlay,
}: FilterEditorShellProps<T>) {
  const meta = getToolMeta(toolId);

  const [file, setFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullSourceCanvas, setFullSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewSourceCanvas, setPreviewSourceCanvas] = useState<HTMLCanvasElement | null>(null);

  const [options, setOptions] = useState<T>(defaultOptions);

  const [format, setFormat] = useState<EncodableMime>(forcedDefaultFormat || 'image/jpeg');
  const [quality, setQuality] = useState<number>(92);

  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [compareToggle, setCompareToggle] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState<string>('');

  const previewDisplayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const renderSeqRef = useRef<number>(0);

  const formatSelectId = useId();

  // Reset when loading a new file
  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    const selected = files[0];
    setLoadError(null);
    setResultBlob(null);

    try {
      const img = await decodeImage(selected);
      const full = imageToCanvas(img);
      const preview = createPreviewCanvas(full, 1200);

      const hasAlpha = hasAlphaChannel(preview);
      const initialFormat: EncodableMime = forcedDefaultFormat || (hasAlpha ? 'image/png' : 'image/jpeg');

      setFullSourceCanvas(full);
      setPreviewSourceCanvas(preview);
      setFormat(initialFormat);
      setQuality(92);
      setOptions(defaultOptions);
      setFile(selected);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to decode image');
    }
  };

  const handleResetOptions = () => {
    setOptions(defaultOptions);
  };

  const handleFullReset = () => {
    setFile(null);
    setFullSourceCanvas(null);
    setPreviewSourceCanvas(null);
    setResultBlob(null);
    setOptions(defaultOptions);
    setLoadError(null);
  };

  // Re-run preview render when options or previewSourceCanvas changes
  useEffect(() => {
    if (!previewSourceCanvas || !previewDisplayCanvasRef.current) return;

    const seq = ++renderSeqRef.current;
    const targetCanvas = previewDisplayCanvasRef.current;

    if (isComparing || compareToggle) {
      // Show original preview canvas
      targetCanvas.width = previewSourceCanvas.width;
      targetCanvas.height = previewSourceCanvas.height;
      const ctx = targetCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        ctx.drawImage(previewSourceCanvas, 0, 0);
      }
      return;
    }

    Promise.resolve(render(previewSourceCanvas, options, true))
      .then((renderedCanvas) => {
        if (seq !== renderSeqRef.current) return; // Stale render
        targetCanvas.width = renderedCanvas.width;
        targetCanvas.height = renderedCanvas.height;
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
          ctx.drawImage(renderedCanvas, 0, 0);
        }
      })
      .catch((err) => {
        if (seq !== renderSeqRef.current) return;
        console.error('Preview render failed:', err);
      });
  }, [previewSourceCanvas, options, isComparing, compareToggle, render]);

  const handleDownload = async () => {
    if (!fullSourceCanvas || !file) return;

    setIsProcessing(true);
    try {
      const renderedCanvas = await render(fullSourceCanvas, options, false);
      const q = format === 'image/png' ? undefined : quality / 100;
      const blob = await canvasToBlob(renderedCanvas, format, q);

      const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
      const outName = withSuffix(file.name, suffix, ext);

      downloadBlob(blob, outName);
      setResultBlob(blob);
      setResultFilename(outName);
    } catch (err: any) {
      alert(`Export failed: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={toolId}>
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image or drag it here"
          hint="Supports JPG, PNG, WebP, SVG, AVIF, HEIC and more."
          onFiles={handleFiles}
        />
      ) : resultBlob ? (
        <ResultPanel blob={resultBlob} filename={resultFilename} kind="image" originalSize={file.size} onReset={handleFullReset}>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <Button variant="secondary" onClick={() => setResultBlob(null)}>
              ← Back to editing
            </Button>
          </div>
        </ResultPanel>
      ) : (
        <div className={styles.editorContainer}>
          {loadError && <div className="error-banner">{loadError}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              Name: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>{formatBytes(file.size)}</strong>
            </span>
            {fullSourceCanvas && (
              <span className="meta-chip">
                Dimensions:{' '}
                <strong>
                  {fullSourceCanvas.width} × {fullSourceCanvas.height}
                </strong>
              </span>
            )}
          </div>

          <div className={styles.previewSection} ref={previewContainerRef}>
            <div className={styles.previewToolbar}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`${styles.compareButton} ${isComparing ? styles.compareButtonActive : ''}`}
                  onPointerDown={() => setIsComparing(true)}
                  onPointerUp={() => setIsComparing(false)}
                  onPointerLeave={() => setIsComparing(false)}
                  title="Press and hold to view original"
                  data-testid="compare-btn"
                >
                  👁️ Compare (hold)
                </button>
                <label style={{ fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input type="checkbox" checked={compareToggle} onChange={(e) => setCompareToggle(e.target.checked)} />
                  <span>Show original</span>
                </label>
              </div>

              <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                Preview resolution: {previewSourceCanvas ? `${previewSourceCanvas.width} × ${previewSourceCanvas.height}` : '...'}
              </div>
            </div>

            <div className={styles.canvasWrapper}>
              <canvas
                ref={previewDisplayCanvasRef}
                className={styles.canvas}
                role="img"
                aria-label="Live preview of the edited image"
                data-testid="preview-canvas"
              />
              {renderOverlay && previewSourceCanvas && (
                <div className={styles.overlayLayer}>
                  {renderOverlay(options, setOptions, {
                    imageWidth: fullSourceCanvas?.width || 0,
                    imageHeight: fullSourceCanvas?.height || 0,
                    previewWidth: previewSourceCanvas.width,
                    previewHeight: previewSourceCanvas.height,
                  })}
                </div>
              )}
            </div>
          </div>

          <div className={styles.controlsGrid}>
            {renderControls(options, setOptions, {
              imageWidth: fullSourceCanvas?.width || 0,
              imageHeight: fullSourceCanvas?.height || 0,
              previewCanvas: previewSourceCanvas,
              previewContainerRef,
            })}

            <div className={styles.exportSection}>
              <div className={styles.formatRow}>
                <Field label="Output format">
                  <Select
                    id={formatSelectId}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as EncodableMime)}
                    options={[
                      { value: 'image/png', label: 'PNG (.png, preserves transparency)' },
                      { value: 'image/jpeg', label: 'JPG (.jpg)' },
                      { value: 'image/webp', label: 'WebP (.webp)' },
                    ]}
                  />
                </Field>

                {format !== 'image/png' && (
                  <Field label={`Quality (${quality}%)`}>
                    <Slider value={quality} min={1} max={100} step={1} unit="%" onChange={setQuality} />
                  </Field>
                )}
              </div>

              <div className={styles.actionRow}>
                <Button variant="secondary" onClick={handleResetOptions}>
                  Reset settings
                </Button>
                <Button variant="secondary" onClick={handleFullReset}>
                  Choose different file
                </Button>
                <Button variant="primary" onClick={handleDownload} disabled={isProcessing} data-testid="download-btn">
                  {isProcessing ? 'Processing full image...' : 'Download'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
