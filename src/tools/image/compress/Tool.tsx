import { useState, useId, useEffect, useRef } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { compressImage, detectAlpha, renderScaledCanvas, type CompressResult } from '../_basic';
import { createBoundedPngPreview, encodeBoundedPreview } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';

type MaxDimensionOption = 'original' | '1920' | '1280' | '1080' | '800' | 'custom';

export default function CompressTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-compress');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImage, setDecodedImage] = useState<HTMLImageElement | null>(null);
  const [sourcePreviewBlob, setSourcePreviewBlob] = useState<Blob | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number; hasAlpha: boolean } | null>(null);
  const [quality, setQuality] = useState<number>(75);
  const [maxDimensionOpt, setMaxDimensionOpt] = useState<MaxDimensionOption>('original');
  const [customMaxDim, setCustomMaxDim] = useState<number>(1920);
  const [format, setFormat] = useState<EncodableMime>('image/jpeg');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CompressResult | null>(null);
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

  const formatId = useId();
  const maxDimId = useId();

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
      const testCanvas = renderScaledCanvas(img, img.width, img.height, img.width, img.height);
      const hasAlpha = detectAlpha(testCanvas);
      setImgMeta({ width: img.width, height: img.height, hasAlpha });
      try {
        const sourceBlob = await createBoundedPngPreview(img, img.width, img.height);
        if (sequence === loadSequenceRef.current) setSourcePreviewBlob(sourceBlob);
      } catch {
        // Preview encoding is optional; compression can still use the decoded source.
        if (sequence === loadSequenceRef.current) setSourcePreviewError(true);
      }

      // Default format: PNG input with alpha -> WEBP by default, else JPG or WEBP
      const isPng = selected.type === 'image/png' || /\.png$/i.test(selected.name);
      const isWebp = selected.type === 'image/webp' || /\.webp$/i.test(selected.name);

      if (isWebp || (isPng && hasAlpha)) {
        setFormat('image/webp');
      } else {
        setFormat('image/jpeg');
      }
    } catch {
      if (sequence === loadSequenceRef.current) setMetaError(t('Could not read image. The file may be corrupt or unsupported.'));
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
    setPreview(null);
    setPreviewPending(false);
    setPreviewError(false);
    job.reset();
  };

  const effectiveMaxDim = (): number | undefined => {
    if (maxDimensionOpt === 'original') return undefined;
    if (maxDimensionOpt === 'custom') return customMaxDim > 0 ? customMaxDim : undefined;
    return parseInt(maxDimensionOpt, 10);
  };

  const targetDimensions = (() => {
    if (!imgMeta) return { width: 0, height: 0 };
    const maxDimension = effectiveMaxDim();
    const scale = maxDimension ? Math.min(1, maxDimension / Math.max(imgMeta.width, imgMeta.height)) : 1;
    return {
      width: Math.max(1, Math.round(imgMeta.width * scale)),
      height: Math.max(1, Math.round(imgMeta.height * scale)),
    };
  })();
  const previewKey = `${targetDimensions.width}:${targetDimensions.height}:${format}:${quality}`;
  const currentPreview = preview?.file === file && preview.key === previewKey ? preview : null;
  const previewUrl = currentPreview?.url;

  useEffect(() => {
    if (!file || !decodedImage || !imgMeta || job.status !== 'idle' || targetDimensions.width <= 0 || targetDimensions.height <= 0) {
      setPreviewPending(false);
      return;
    }
    setPreviewPending(true);
    setPreviewError(false);
    let active = true;
    let createdUrl: string | null = null;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await encodeBoundedPreview(decodedImage, targetDimensions.width, targetDimensions.height, format, quality / 100);
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setPreview({ file, key: previewKey, url: createdUrl, estimatedBytes: result.estimatedBytes });
      } catch {
        if (active) setPreviewError(true);
      } finally {
        if (active) setPreviewPending(false);
      }
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [decodedImage, file, format, imgMeta, job.status, previewKey, quality, targetDimensions.height, targetDimensions.width]);

  const handleCompress = () => {
    if (!file) return;

    loadSequenceRef.current += 1;
    setDecodedImage(null);
    job.run(async (setProgress) => {
      setProgress(0.2);
      const res = await compressImage(file, {
        quality: quality / 100,
        maxDimension: effectiveMaxDim(),
        format,
      });
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-compress">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image or drag it here')}
          hint={t('Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
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
              {resultInfo.isLarger && (
                <div
                  className="error-banner"
                  style={{ marginBottom: '1.25rem', backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#eab308', color: 'inherit' }}
                >
                  <p style={{ margin: 0, fontWeight: 500 }}>
                    {t(
                      'Notice: The compressed file is larger than the original input. This can occur when an image is already heavily compressed.',
                    )}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <span>{t('Original ({size})', { size: formatBytes(file.size) })}</span>
                    <Button variant="secondary" onClick={() => downloadBlob(file, file.name)}>
                      {t('Download')}
                    </Button>
                    <CopyImageButton getImage={() => file} filename={file.name} />
                  </div>
                </div>
              )}
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
                  <>
                    <span className="meta-chip">
                      {t('Dimensions')}:{' '}
                      <strong>
                        {imgMeta.width}×{imgMeta.height} px
                      </strong>
                    </span>
                    {imgMeta.hasAlpha && (
                      <span className="meta-chip">
                        {t('Transparency')}: <strong>{t('Detected')}</strong>
                      </span>
                    )}
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Compressing image...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {decodedImage && imgMeta && (
                    <ImagePreviewPair
                      sourceUrl={sourcePreviewUrl}
                      outputUrl={previewUrl}
                      sourceAlt={t('Original image preview')}
                      outputAlt={t('Compressed image preview')}
                      sourceLabel={t('Original image')}
                      outputLabel={t('Compression preview')}
                      sourceDetails={`${imgMeta.width}×${imgMeta.height} px`}
                      outputDetails={
                        currentPreview
                          ? `${targetDimensions.width}×${targetDimensions.height} px · ${t('Approx. output size: {size}', { size: formatBytes(currentPreview.estimatedBytes) })}`
                          : undefined
                      }
                      note={t('This comparison encodes a bounded sample. The download is encoded at the dimensions shown.')}
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

                  <Field label={t('Quality')} hint={t('Lower values usually produce smaller files.')}>
                    <Slider value={quality} min={5} max={95} step={1} unit="%" onChange={setQuality} />
                  </Field>

                  <details className="tool-options">
                    <summary>{t('Advanced options')}</summary>
                    <div className="tool-options-body">
                      <Field label={t('Max dimension')} hint={t('Limit the longest edge to reduce file size further.')}>
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
                            { value: 'custom', label: t('Custom max dimension') },
                          ]}
                        />
                      </Field>

                      {maxDimensionOpt === 'custom' && (
                        <Field label={t('Custom max edge (px)')}>
                          <input
                            type="number"
                            min={50}
                            max={10000}
                            value={customMaxDim}
                            onChange={(e) => setCustomMaxDim(parseInt(e.target.value, 10) || 100)}
                            className="select"
                          />
                        </Field>
                      )}

                      <Field
                        label={t('Output format')}
                        hint={
                          format === 'image/webp'
                            ? t('WebP preserves transparency.')
                            : imgMeta?.hasAlpha
                              ? t('JPEG does not support transparency.')
                              : undefined
                        }
                      >
                        <Select
                          id={formatId}
                          value={format}
                          onChange={(e) => setFormat(e.target.value as EncodableMime)}
                          options={[
                            { value: 'image/jpeg', label: t('JPG') },
                            { value: 'image/webp', label: t('WebP (supports transparency)') },
                          ]}
                        />
                      </Field>
                    </div>
                  </details>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different image')}
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      {t('Compress image')}
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
