import { useState, useId, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { IMAGE_ACCEPT, decodeImage, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { resizeImage, getDefaultFormat } from '../_basic';
import { createBoundedPngPreview, encodeBoundedPreview } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';
import styles from '../_basic/basic.module.css';

type BulkResizeMode = 'percent' | 'maxDim';
type FormatChoice = 'keep' | 'image/jpeg' | 'image/png' | 'image/webp';

export default function BulkResizeTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-bulk-resize');
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<BulkResizeMode>('percent');
  const [percent, setPercent] = useState<number>(50);
  const [maxDimension, setMaxDimension] = useState<number>(1920);
  const [formatChoice, setFormatChoice] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState<number>(85);

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<{ file: File; image: HTMLImageElement } | null>(null);
  const [sourcePreviewBlob, setSourcePreviewBlob] = useState<Blob | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [targetPreview, setTargetPreview] = useState<{
    file: File;
    key: string;
    url: string;
    bytes: number;
    width: number;
    height: number;
  } | null>(null);
  const [targetPreviewPending, setTargetPreviewPending] = useState(false);
  const [targetPreviewError, setTargetPreviewError] = useState(false);

  const modeId = useId();
  const formatId = useId();
  const previewFile = files[0] || null;
  const previewImage = decodedPreview?.file === previewFile ? decodedPreview.image : null;
  const sourcePreviewUrl = useObjectUrl(sourcePreviewBlob);

  useEffect(() => {
    if (!previewFile || results || processing) {
      setDecodedPreview(null);
      setSourcePreviewBlob(null);
      return;
    }
    let active = true;
    setDecodedPreview(null);
    setSourcePreviewBlob(null);
    setSourcePreviewError(false);
    decodeImage(previewFile)
      .then(async (image) => {
        if (!active) return;
        setDecodedPreview({ file: previewFile, image });
        const blob = await createBoundedPngPreview(image, image.width, image.height);
        if (active) setSourcePreviewBlob(blob);
      })
      .catch(() => {
        if (active) setSourcePreviewError(true);
      });
    return () => {
      active = false;
    };
  }, [previewFile, results, processing]);

  const previewScale = previewImage
    ? mode === 'percent'
      ? percent / 100
      : Math.min(1, maxDimension / Math.max(previewImage.width, previewImage.height))
    : 1;
  const previewWidth = previewImage ? Math.max(1, Math.round(previewImage.width * previewScale)) : 0;
  const previewHeight = previewImage ? Math.max(1, Math.round(previewImage.height * previewScale)) : 0;
  const previewMime: EncodableMime =
    formatChoice === 'keep' ? (previewFile ? getDefaultFormat(previewFile, 'image/png').mime : 'image/png') : formatChoice;
  const previewKey = `${mode}:${percent}:${maxDimension}:${previewWidth}:${previewHeight}:${formatChoice}:${quality}`;
  const currentTargetPreview = targetPreview?.file === previewFile && targetPreview.key === previewKey ? targetPreview : null;

  useEffect(() => {
    if (!previewFile || !previewImage || processing || results || previewWidth <= 0 || previewHeight <= 0) {
      setTargetPreviewPending(false);
      return;
    }
    setTargetPreviewPending(true);
    setTargetPreviewError(false);
    let active = true;
    let createdUrl: string | null = null;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await encodeBoundedPreview(previewImage, previewWidth, previewHeight, previewMime, quality / 100);
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setTargetPreview({
          file: previewFile,
          key: previewKey,
          url: createdUrl,
          bytes: result.estimatedBytes,
          width: previewWidth,
          height: previewHeight,
        });
      } catch {
        if (active) setTargetPreviewError(true);
      } finally {
        if (active) setTargetPreviewPending(false);
      }
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [previewFile, previewImage, previewHeight, previewKey, previewMime, previewWidth, processing, quality, results]);

  const handleFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setFiles(newFiles);
    setResults(null);
    setError(null);
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setProcessing(false);
    setProgress(0);
  };

  const handleProcess = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);

    const outputItems: BatchResultItem[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const img = await decodeImage(file);

        let targetW = img.width;
        let targetH = img.height;

        if (mode === 'percent') {
          targetW = Math.max(1, Math.round(img.width * (percent / 100)));
          targetH = Math.max(1, Math.round(img.height * (percent / 100)));
        } else {
          const maxEdge = Math.max(img.width, img.height);
          if (maxEdge > maxDimension) {
            const scale = maxDimension / maxEdge;
            targetW = Math.max(1, Math.round(img.width * scale));
            targetH = Math.max(1, Math.round(img.height * scale));
          }
        }

        const outMime: EncodableMime | undefined = formatChoice === 'keep' ? getDefaultFormat(file, 'image/png').mime : formatChoice;

        const res = await resizeImage(file, {
          source: img,
          width: targetW,
          height: targetH,
          format: outMime,
          quality: quality / 100,
        });

        outputItems.push({
          name: res.filename,
          blob: res.blob,
          originalSize: file.size,
        });

        setProgress((i + 1) / files.length);
      }

      setResults(outputItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while resizing images.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-bulk-resize">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label={t('Choose multiple images or drag them here')}
          hint={t('Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF. Process many at once.')}
          onFiles={handleFiles}
        />
      ) : results ? (
        <BatchResults items={results} onReset={handleReset} />
      ) : (
        <div>
          {error && <div className="error-banner">{t(error)}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              {t('Selected files')}: <strong>{files.length}</strong>
            </span>
            <span className="meta-chip">
              {t('Total size')}: <strong>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</strong>
            </span>
          </div>

          {!processing && previewFile && previewImage && (
            <ImagePreviewPair
              sourceUrl={sourcePreviewUrl}
              outputUrl={currentTargetPreview?.url}
              sourceAlt={t('Original image preview')}
              outputAlt={t('Resized image preview')}
              sourceLabel={files.length > 1 ? t('Previewing first of {count} images', { count: files.length }) : t('Original image')}
              outputLabel={t('Resize preview')}
              sourceDetails={`${previewFile.name} · ${previewImage.width}×${previewImage.height} px`}
              outputDetails={
                currentTargetPreview
                  ? `${currentTargetPreview.width}×${currentTargetPreview.height} px · ${t('Approx. output size: {size}', { size: formatBytes(currentTargetPreview.bytes) })}`
                  : undefined
              }
              note={t(
                'Only the first selected image is previewed. Preview size and file-size estimates are approximate; batch export processes every selected image.',
              )}
              pending={targetPreviewPending}
              pendingLabel={t('Preparing preview…')}
              sourcePending={!sourcePreviewUrl && !sourcePreviewError}
              sourceUnavailable={t('Source preview is unavailable for this image.')}
              outputUnavailable={
                targetPreviewError ? t('Preview could not be created. Adjust settings or choose another format.') : t('Preparing preview…')
              }
            />
          )}

          {processing ? (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar
                value={progress}
                label={t('Resizing images ({current} of {total})...', {
                  current: Math.round(progress * files.length),
                  total: files.length,
                })}
              />
            </div>
          ) : (
            <div style={{ marginTop: '1.5rem' }}>
              <Field label={t('Resize mode')}>
                <Select
                  id={modeId}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as BulkResizeMode)}
                  options={[
                    { value: 'percent', label: t('Scale by percentage (recommended for mixed sizes)') },
                    { value: 'maxDim', label: t('Constrain max dimension') },
                  ]}
                />
              </Field>

              {mode === 'percent' ? (
                <Field label={t('Scale percentage')}>
                  <Slider value={percent} min={5} max={200} step={5} unit="%" onChange={setPercent} />
                  <div className={styles.presetChips}>
                    {[25, 50, 75, 100, 150].map((p) => (
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
                <Field label={t('Max dimension (px)')} hint={t('Images larger than this max width/height will be scaled down')}>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={maxDimension}
                    onChange={(e) => setMaxDimension(parseInt(e.target.value, 10) || 100)}
                    className={styles.inputNumber}
                  />
                  <div className={styles.presetChips}>
                    {[800, 1080, 1280, 1920, 2560].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.presetChip} ${maxDimension === d ? styles.presetChipActive : ''}`}
                        onClick={() => setMaxDimension(d)}
                      >
                        {d} px
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={t('Output format')}>
                <Select
                  id={formatId}
                  value={formatChoice}
                  onChange={(e) => setFormatChoice(e.target.value as FormatChoice)}
                  options={[
                    { value: 'keep', label: t('Keep original format') },
                    { value: 'image/jpeg', label: t('JPG') },
                    { value: 'image/png', label: t('PNG') },
                    { value: 'image/webp', label: t('WEBP') },
                  ]}
                />
              </Field>

              {formatChoice !== 'image/png' && (
                <Field label={t('Quality')}>
                  <Slider value={quality} min={10} max={100} step={1} unit="%" onChange={setQuality} />
                </Field>
              )}

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Choose different files')}
                </Button>
                <Button variant="primary" onClick={handleProcess}>
                  {t('Resize {count} images', { count: files.length })}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
