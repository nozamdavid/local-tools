import React, { useState, useEffect, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, imageToCanvas, canvasToBlob, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { formatBytes, withSuffix } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { hasAlphaChannel, createPreviewCanvas } from './common';
import styles from './FilterEditorShell.module.css';

type Translator = (sourceEnglish: string, params?: Record<string, string | number>) => string;

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
      t: Translator;
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
      t: Translator;
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
  const { t } = useI18n();
  const meta = getToolMeta(toolId);

  const [file, setFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullSourceCanvas, setFullSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewSourceCanvas, setPreviewSourceCanvas] = useState<HTMLCanvasElement | null>(null);

  const [options, setOptions] = useState<T>(defaultOptions);

  const [format, setFormat] = useState<EncodableMime>(forcedDefaultFormat || 'image/jpeg');
  const [quality, setQuality] = useState<number>(92);

  const [showOriginal, setShowOriginal] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState<string>('');

  const previewDisplayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const sourceRequest = useRef(0);

  const formatSelectId = useId();

  useEffect(() => () => {
    sourceRequest.current++;
  }, []);

  // Reset when loading a new file
  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    const selected = files[0];
    const request = ++sourceRequest.current;
    setLoadError(null);
    setResultBlob(null);

    try {
      const img = await decodeImage(selected);
      if (request !== sourceRequest.current) return;
      const full = imageToCanvas(img);
      const preview = createPreviewCanvas(full);

      const hasAlpha = hasAlphaChannel(preview);
      const initialFormat: EncodableMime = forcedDefaultFormat || (hasAlpha ? 'image/png' : 'image/jpeg');

      setFullSourceCanvas(full);
      setPreviewSourceCanvas(preview);
      setFormat(initialFormat);
      setQuality(92);
      setOptions(defaultOptions);
      setFile(selected);
    } catch (err: any) {
      if (request === sourceRequest.current) setLoadError(err?.message || 'Failed to decode image');
    }
  };

  const handleResetOptions = () => {
    setOptions(defaultOptions);
  };

  const handleFullReset = () => {
    sourceRequest.current++;
    setFile(null);
    setFullSourceCanvas(null);
    setPreviewSourceCanvas(null);
    setResultBlob(null);
    setOptions(defaultOptions);
    setLoadError(null);
    setIsProcessing(false);
  };

  // Re-run preview render when options or previewSourceCanvas changes
  useEffect(() => {
    if (!previewSourceCanvas || !previewDisplayCanvasRef.current) return;

    const targetCanvas = previewDisplayCanvasRef.current;

    if (showOriginal) {
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

    let active = true;
    Promise.resolve()
      .then(() => render(previewSourceCanvas, options, true))
      .then((renderedCanvas) => {
        if (!active) return;
        targetCanvas.width = renderedCanvas.width;
        targetCanvas.height = renderedCanvas.height;
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
          ctx.drawImage(renderedCanvas, 0, 0);
        }
      })
      .catch((err) => {
        if (active) console.error('Preview render failed:', err);
      });
    return () => {
      active = false;
    };
  }, [previewSourceCanvas, options, showOriginal, render]);

  const exportExt = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
  const exportFilename = file ? withSuffix(file.name, suffix, exportExt) : '';

  const getExportBlob = async () => {
    if (!fullSourceCanvas) throw new Error(t('Failed to decode image'));
    const request = sourceRequest.current;
    setIsProcessing(true);
    try {
      const renderedCanvas = await render(fullSourceCanvas, options, false);
      const q = format === 'image/png' ? undefined : quality / 100;
      return await canvasToBlob(renderedCanvas, format, q);
    } finally {
      if (request === sourceRequest.current) setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    const request = sourceRequest.current;
    try {
      const blob = await getExportBlob();
      if (request !== sourceRequest.current) return;
      downloadBlob(blob, exportFilename);
      setResultBlob(blob);
      setResultFilename(exportFilename);
    } catch (err: any) {
      if (request === sourceRequest.current) alert(t('Export failed: {error}', { error: err?.message || String(err) }));
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={toolId}>
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or drag it here')}
          hint={t('Supports JPG, PNG, WebP, SVG, AVIF, HEIC and more.')}
          onFiles={handleFiles}
        />
      ) : resultBlob ? (
        <ResultPanel blob={resultBlob} filename={resultFilename} kind="image" originalSize={file.size} onReset={handleFullReset}>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <Button variant="secondary" onClick={() => setResultBlob(null)}>
              {t('Back to editing')}
            </Button>
          </div>
        </ResultPanel>
      ) : (
        <div className={styles.editorContainer}>
          {loadError && <div className="error-banner">{t(loadError)}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              {t('Name')}: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              {t('Size')}: <strong>{formatBytes(file.size)}</strong>
            </span>
            {fullSourceCanvas && (
              <span className="meta-chip">
                {t('Dimensions')}:{' '}
                <strong>
                  {fullSourceCanvas.width} × {fullSourceCanvas.height}
                </strong>
              </span>
            )}
          </div>

          <div className={styles.previewSection} ref={previewContainerRef}>
            <div className={styles.previewToolbar}>
              <button
                type="button"
                className={`${styles.compareButton} ${showOriginal ? styles.compareButtonActive : ''}`}
                aria-pressed={showOriginal}
                onClick={() => setShowOriginal((current) => !current)}
                title={showOriginal ? t('Show edited preview') : t('Show original image')}
                data-testid="compare-btn"
              >
                {t('Show original')}
              </button>
              <span className={styles.previewNote}>{t('Preview is scaled for editing; downloads use the full-resolution image.')}</span>
            </div>

            <div className={styles.canvasWrapper}>
              <canvas
                ref={previewDisplayCanvasRef}
                className={styles.canvas}
                role="img"
                aria-label={t('Live preview of the edited image')}
                data-testid="preview-canvas"
              />
              {renderOverlay && previewSourceCanvas && (
                <div className={styles.overlayLayer}>
                  {renderOverlay(options, setOptions, {
                    imageWidth: fullSourceCanvas?.width || 0,
                    imageHeight: fullSourceCanvas?.height || 0,
                    previewWidth: previewSourceCanvas.width,
                    previewHeight: previewSourceCanvas.height,
                    t,
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
              t,
            })}

            <div className={styles.exportSection}>
              <div className={styles.formatRow}>
                <Field label={t('Output format')}>
                  <Select
                    id={formatSelectId}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as EncodableMime)}
                    options={[
                      { value: 'image/png', label: t('PNG (.png, preserves transparency)') },
                      { value: 'image/jpeg', label: t('JPG (.jpg)') },
                      { value: 'image/webp', label: t('WebP (.webp)') },
                    ]}
                  />
                </Field>

                {format !== 'image/png' && (
                  <Field label={t('Quality ({quality}%)', { quality })}>
                    <Slider value={quality} min={1} max={100} step={1} unit="%" onChange={setQuality} />
                  </Field>
                )}
              </div>

              <div className={styles.actionRow}>
                <Button variant="secondary" onClick={handleResetOptions}>
                  {t('Reset settings')}
                </Button>
                <Button variant="secondary" onClick={handleFullReset}>
                  {t('Choose different file')}
                </Button>
                <Button variant="primary" onClick={handleDownload} loading={isProcessing} data-testid="download-btn">
                  {t('Download')}
                </Button>
                <CopyImageButton getImage={getExportBlob} disabled={isProcessing} filename={exportFilename} />
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
