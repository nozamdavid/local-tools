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
import { compressImage, detectAlpha } from '../_basic';
import { createBoundedPngPreview, encodeBoundedPreview, renderBoundedCanvas } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';

type MaxDimensionOption = 'original' | '1920' | '1280' | '1080' | '800';
type FormatOption = 'auto' | 'image/jpeg' | 'image/webp';

export default function BulkCompressTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-bulk-compress');
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState<number>(75);
  const [maxDimensionOpt, setMaxDimensionOpt] = useState<MaxDimensionOption>('original');
  const [formatChoice, setFormatChoice] = useState<FormatOption>('auto');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<{ file: File; image: HTMLImageElement } | null>(null);
  const [previewAlpha, setPreviewAlpha] = useState(false);
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

  const maxDimId = useId();
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
    setPreviewAlpha(false);
    decodeImage(previewFile)
      .then(async (image) => {
        if (!active) return;
        setDecodedPreview({ file: previewFile, image });
        const sample = renderBoundedCanvas(image, image.width, image.height);
        setPreviewAlpha(detectAlpha(sample));
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

  const maxDimension = maxDimensionOpt === 'original' ? undefined : parseInt(maxDimensionOpt, 10);
  const previewScale = previewImage && maxDimension ? Math.min(1, maxDimension / Math.max(previewImage.width, previewImage.height)) : 1;
  const previewWidth = previewImage ? Math.max(1, Math.round(previewImage.width * previewScale)) : 0;
  const previewHeight = previewImage ? Math.max(1, Math.round(previewImage.height * previewScale)) : 0;
  const previewMime: EncodableMime =
    formatChoice === 'auto'
      ? previewFile?.type === 'image/webp' ||
        /\.webp$/i.test(previewFile?.name || '') ||
        ((previewFile?.type === 'image/png' || /\.png$/i.test(previewFile?.name || '')) && previewAlpha)
        ? 'image/webp'
        : 'image/jpeg'
      : formatChoice;
  const previewKey = `${previewWidth}:${previewHeight}:${quality}:${previewMime}`;
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

    const maxDim = maxDimensionOpt === 'original' ? undefined : parseInt(maxDimensionOpt, 10);
    const chosenFormat: EncodableMime | undefined = formatChoice === 'auto' ? undefined : formatChoice;

    const outputItems: BatchResultItem[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await compressImage(file, {
          quality: quality / 100,
          maxDimension: maxDim,
          format: chosenFormat,
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
      setError(err instanceof Error ? err.message : 'An error occurred while compressing images.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-bulk-compress">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label={t('Choose multiple images or drag them here')}
          hint={t('Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF. Compress many at once.')}
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
              outputAlt={t('Compressed image preview')}
              sourceLabel={files.length > 1 ? t('Previewing first of {count} images', { count: files.length }) : t('Original image')}
              outputLabel={t('Compression preview')}
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
                label={t('Compressing images ({current} of {total})...', {
                  current: Math.round(progress * files.length),
                  total: files.length,
                })}
              />
            </div>
          ) : (
            <div style={{ marginTop: '1.5rem' }}>
              <Field label={t('Quality')} hint={t('Quality slider (default 75). Lower values produce smaller files.')}>
                <Slider value={quality} min={5} max={95} step={1} unit="%" onChange={setQuality} />
              </Field>

              <Field label={t('Max dimension')} hint={t('Constrain the longest edge to reduce size further')}>
                <Select
                  id={maxDimId}
                  value={maxDimensionOpt}
                  onChange={(e) => setMaxDimensionOpt(e.target.value as MaxDimensionOption)}
                  options={[
                    { value: 'original', label: t('Keep original dimensions') },
                    { value: '1920', label: t('1920 px (Full HD)') },
                    { value: '1280', label: t('1280 px (HD)') },
                    { value: '1080', label: t('1080 px (Square / Social)') },
                    { value: '800', label: t('800 px (Web)') },
                  ]}
                />
              </Field>

              <Field label={t('Output format')}>
                <Select
                  id={formatId}
                  value={formatChoice}
                  onChange={(e) => setFormatChoice(e.target.value as FormatOption)}
                  options={[
                    { value: 'auto', label: t('Auto (JPG, or WEBP if transparent)') },
                    { value: 'image/jpeg', label: t('JPG') },
                    { value: 'image/webp', label: t('WEBP') },
                  ]}
                />
              </Field>

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Choose different files')}
                </Button>
                <Button variant="primary" onClick={handleProcess}>
                  {t('Compress {count} images', { count: files.length })}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
