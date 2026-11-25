import { useState, useId, useEffect, useRef } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { useI18n } from '../../../lib/i18n';
import { getDefaultFormat, resizeImage, type ResizeResult } from '../_basic';
import { createBoundedPngPreview, encodeBoundedPreview } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';
import styles from '../_basic/basic.module.css';

type ResizeMode = 'percent' | 'pixels';

export default function ResizeTool() {
  const meta = getToolMeta('img-resize');
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [decodedImage, setDecodedImage] = useState<HTMLImageElement | null>(null);
  const [sourcePreviewBlob, setSourcePreviewBlob] = useState<Blob | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<ResizeMode>('percent');
  const [percent, setPercent] = useState<number>(50);
  const [pixelWidth, setPixelWidth] = useState<number>(0);
  const [pixelHeight, setPixelHeight] = useState<number>(0);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [format, setFormat] = useState<EncodableMime>('image/jpeg');
  const [quality, setQuality] = useState<number>(85);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<ResizeResult | null>(null);
  const [preview, setPreview] = useState<{ file: File; key: string; url: string; estimatedBytes: number } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const loadSequenceRef = useRef(0);

  const job = useJob();
  const sourcePreviewUrl = useObjectUrl(sourcePreviewBlob);

  useEffect(
    () => () => {
      loadSequenceRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (job.status === 'done') setDecodedImage(null);
  }, [job.status]);

  const modeId = useId();
  const formatId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const sequence = ++loadSequenceRef.current;
    setFile(selected);
    setDecodedImage(null);
    setSourcePreviewBlob(null);
    setSourcePreviewError(false);
    setPreview(null);
    setPreviewPending(false);
    setPreviewError(false);
    setMetaError(null);
    setImgMeta(null);
    setResultInfo(null);
    job.reset();

    try {
      const img = await decodeImage(selected);
      if (sequence !== loadSequenceRef.current) return;
      setDecodedImage(img);
      setImgMeta({ width: img.width, height: img.height });
      setPixelWidth(Math.round(img.width * 0.5));
      setPixelHeight(Math.round(img.height * 0.5));
      const defFmt = getDefaultFormat(selected, 'image/png');
      setFormat(defFmt.mime);
      try {
        const sourceBlob = await createBoundedPngPreview(img, img.width, img.height);
        if (sequence === loadSequenceRef.current) setSourcePreviewBlob(sourceBlob);
      } catch {
        // Keep the original image available in the result panel if a small preview cannot be encoded.
        if (sequence === loadSequenceRef.current) setSourcePreviewError(true);
      }
    } catch {
      if (sequence === loadSequenceRef.current) setMetaError(t('Could not decode image. The file may be corrupt or unsupported.'));
    }
  };

  const handleReset = () => {
    loadSequenceRef.current += 1;
    setFile(null);
    setDecodedImage(null);
    setSourcePreviewBlob(null);
    setSourcePreviewError(false);
    setImgMeta(null);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const handleWidthChange = (val: number) => {
    setPixelWidth(val);
    if (lockAspect && imgMeta && imgMeta.width > 0) {
      setPixelHeight(Math.max(1, Math.round((val / imgMeta.width) * imgMeta.height)));
    }
  };

  const handleHeightChange = (val: number) => {
    setPixelHeight(val);
    if (lockAspect && imgMeta && imgMeta.height > 0) {
      setPixelWidth(Math.max(1, Math.round((val / imgMeta.height) * imgMeta.width)));
    }
  };

  const targetW = imgMeta ? (mode === 'percent' ? Math.max(1, Math.round(imgMeta.width * (percent / 100))) : Math.max(1, pixelWidth)) : 0;

  const targetH = imgMeta ? (mode === 'percent' ? Math.max(1, Math.round(imgMeta.height * (percent / 100))) : Math.max(1, pixelHeight)) : 0;

  const previewKey = `${targetW}:${targetH}:${format}:${quality}`;
  const currentPreview = preview?.file === file && preview.key === previewKey ? preview : null;
  const previewUrl = currentPreview?.url;

  useEffect(() => {
    if (!file || !decodedImage || !imgMeta || job.status !== 'idle' || targetW <= 0 || targetH <= 0) {
      setPreviewPending(false);
      return;
    }
    setPreviewPending(true);
    setPreviewError(false);
    let active = true;
    let createdUrl: string | null = null;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await encodeBoundedPreview(decodedImage, targetW, targetH, format, quality / 100);
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setPreview({ file, key: previewKey, url: createdUrl, estimatedBytes: result.estimatedBytes });
      } catch {
        if (active) setPreviewError(true);
      } finally {
        if (active) setPreviewPending(false);
      }
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [decodedImage, file, format, imgMeta, job.status, previewKey, targetH, targetW, quality]);

  const handleResize = () => {
    if (!file || !imgMeta || targetW <= 0 || targetH <= 0) return;

    loadSequenceRef.current += 1;
    setDecodedImage(null);
    job.run(async (setProgress) => {
      setProgress(0.2);
      const res = await resizeImage(file, {
        width: targetW,
        height: targetH,
        format,
        quality: quality / 100,
      });
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-resize">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or drag it here')}
          hint={t('Supports JPG, PNG, WebP, GIF, BMP, SVG, HEIC and AVIF.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={sourcePreviewUrl ? <img src={sourcePreviewUrl} alt={file.name} className="preview-media" /> : null}
              onReset={handleReset}
            >
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  {t('Dimensions')}:{' '}
                  <strong>
                    {imgMeta ? `${imgMeta.width}×${imgMeta.height}` : ''} → {resultInfo.width}×{resultInfo.height} px
                  </strong>
                </span>
              </div>
            </ResultPanel>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name')}: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
                {imgMeta && (
                  <span className="meta-chip">
                    {t('Original dimensions')}:{' '}
                    <strong>
                      {imgMeta.width}×{imgMeta.height} px
                    </strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Resizing image…')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label={t('Resize mode')}>
                    <Select
                      id={modeId}
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ResizeMode)}
                      options={[
                        { value: 'percent', label: t('By percentage') },
                        { value: 'pixels', label: t('By exact pixels') },
                      ]}
                    />
                  </Field>

                  {mode === 'percent' ? (
                    <Field label={t('Scale percentage')} hint={t('Choose a percentage of the original size')}>
                      <Slider value={percent} min={5} max={300} step={5} unit="%" onChange={setPercent} />
                      <div className={styles.presetChips}>
                        {[25, 50, 75, 100, 150, 200].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`${styles.presetChip} ${percent === p ? styles.presetChipActive : ''}`}
                            onClick={() => setPercent(p)}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                    </Field>
                  ) : (
                    <Field label={t('Dimensions (pixels)')} hint={t('Enter the target width and height in pixels')}>
                      <div className={styles.dimensionGrid}>
                        <div>
                          <label className="field-label" style={{ fontSize: '0.85rem' }}>
                            {t('Width')}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20000}
                            value={pixelWidth}
                            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 1)}
                            className={styles.inputNumber}
                          />
                        </div>
                        <button
                          type="button"
                          className={`${styles.lockBtn} ${lockAspect ? styles.lockBtnActive : ''}`}
                          onClick={() => setLockAspect(!lockAspect)}
                          title={lockAspect ? t('Aspect ratio locked') : t('Aspect ratio unlocked')}
                          aria-label={lockAspect ? t('Unlock aspect ratio') : t('Lock aspect ratio')}
                        >
                          {lockAspect ? '🔒' : '🔓'}
                        </button>
                        <div>
                          <label className="field-label" style={{ fontSize: '0.85rem' }}>
                            {t('Height')}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20000}
                            value={pixelHeight}
                            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 1)}
                            className={styles.inputNumber}
                          />
                        </div>
                      </div>
                    </Field>
                  )}

                  {imgMeta && (
                    <div className={styles.sizeComparison} aria-live="polite">
                      <span>
                        {t('Source')}:{' '}
                        <strong>
                          {imgMeta.width}×{imgMeta.height}
                        </strong>
                      </span>
                      <span className={styles.sizeArrow}>→</span>
                      <span>
                        {t('Output')}:{' '}
                        <strong>
                          {targetW}×{targetH} px
                        </strong>
                      </span>
                    </div>
                  )}

                  {imgMeta && decodedImage && (
                    <ImagePreviewPair
                      sourceUrl={sourcePreviewUrl}
                      outputUrl={previewUrl}
                      sourceAlt={t('Original image preview')}
                      outputAlt={t('Resized image preview')}
                      sourceLabel={t('Original image')}
                      outputLabel={t('Resize preview')}
                      sourceDetails={`${imgMeta.width}×${imgMeta.height} px`}
                      outputDetails={
                        currentPreview
                          ? `${targetW}×${targetH} px · ${t('Approx. output size: {size}', { size: formatBytes(currentPreview.estimatedBytes) })}`
                          : undefined
                      }
                      note={t('This preview is scaled to fit. The download uses the exact requested dimensions.')}
                      pending={previewPending}
                      pendingLabel={t('Preparing preview…')}
                      sourcePending={!!decodedImage && !sourcePreviewUrl && !sourcePreviewError}
                      sourceUnavailable={t('Source preview is unavailable for this image.')}
                      outputUnavailable={
                        previewError
                          ? t('Preview could not be created. Adjust settings or choose another format.')
                          : t('Preparing preview…')
                      }
                    />
                  )}

                  <details className="tool-options">
                    <summary>{t('Output options')}</summary>
                    <div className="tool-options-body">
                      <Field label={t('Output format')}>
                        <Select
                          id={formatId}
                          value={format}
                          onChange={(e) => setFormat(e.target.value as EncodableMime)}
                          options={[
                            { value: 'image/jpeg', label: t('JPG') },
                            { value: 'image/png', label: t('PNG') },
                            { value: 'image/webp', label: t('WebP') },
                          ]}
                        />
                      </Field>

                      {format !== 'image/png' && (
                        <Field label={t('Quality')} hint={t('Higher quality usually means a larger file.')}>
                          <Slider value={quality} min={10} max={100} step={1} unit="%" onChange={setQuality} />
                        </Field>
                      )}
                    </div>
                  </details>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose a different image')}
                    </Button>
                    <Button variant="primary" onClick={handleResize}>
                      {t('Resize image')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
