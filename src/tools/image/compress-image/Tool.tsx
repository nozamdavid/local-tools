import { useState, useEffect, useRef } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, IMAGE_ACCEPT } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { compressToTargetSize, type TargetSizeResult } from '../_basic';
import { createBoundedPngPreview, createTargetCompressionPreview } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';
import styles from '../_basic/basic.module.css';

type SizeUnit = 'KB' | 'MB';

interface Preset {
  label: string;
  bytes: number;
  val: number;
  unit: SizeUnit;
}

const PRESETS: Preset[] = [
  { label: '50 KB', bytes: 50 * 1024, val: 50, unit: 'KB' },
  { label: '100 KB', bytes: 100 * 1024, val: 100, unit: 'KB' },
  { label: '200 KB', bytes: 200 * 1024, val: 200, unit: 'KB' },
  { label: '500 KB', bytes: 500 * 1024, val: 500, unit: 'KB' },
  { label: '1 MB', bytes: 1024 * 1024, val: 1, unit: 'MB' },
];

export default function CompressImageTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-compress-image');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImage, setDecodedImage] = useState<HTMLImageElement | null>(null);
  const [sourcePreviewBlob, setSourcePreviewBlob] = useState<Blob | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number } | null>(null);
  const [targetValue, setTargetValue] = useState<number>(100);
  const [unit, setUnit] = useState<SizeUnit>('KB');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<TargetSizeResult | null>(null);
  const [preview, setPreview] = useState<{
    file: File;
    key: string;
    url: string;
    estimatedBytes: number;
    outputWidth: number;
    outputHeight: number;
    quality: number;
  } | null>(null);
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
      try {
        const sourceBlob = await createBoundedPngPreview(img, img.width, img.height);
        if (sequence === loadSequenceRef.current) setSourcePreviewBlob(sourceBlob);
      } catch {
        // Compression can proceed if the small source preview is unavailable.
        if (sequence === loadSequenceRef.current) setSourcePreviewError(true);
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

  const targetBytes = Math.round(targetValue * (unit === 'MB' ? 1024 * 1024 : 1024));
  const previewKey = `${targetBytes}`;
  const currentPreview = preview?.file === file && preview.key === previewKey ? preview : null;
  const previewUrl = currentPreview?.url;

  useEffect(() => {
    if (!file || !decodedImage || !imgMeta || job.status !== 'idle' || targetBytes <= 0) {
      setPreviewPending(false);
      return;
    }
    setPreviewPending(true);
    setPreviewError(false);
    let active = true;
    let createdUrl: string | null = null;
    const isWebp = file.type === 'image/webp' || /\.webp$/i.test(file.name);
    const preferWebp = isWebp;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await createTargetCompressionPreview(decodedImage, imgMeta.width, imgMeta.height, targetBytes, preferWebp);
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setPreview({
          file,
          key: previewKey,
          url: createdUrl,
          estimatedBytes: result.estimatedBytes,
          outputWidth: result.outputWidth,
          outputHeight: result.outputHeight,
          quality: result.quality,
        });
      } catch {
        if (active) setPreviewError(true);
      } finally {
        if (active) setPreviewPending(false);
      }
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [decodedImage, file, imgMeta, job.status, previewKey, targetBytes]);

  const applyPreset = (preset: Preset) => {
    setTargetValue(preset.val);
    setUnit(preset.unit);
  };

  const handleCompress = () => {
    if (!file || targetBytes <= 0) return;

    loadSequenceRef.current += 1;
    setDecodedImage(null);
    job.run(async (setProgress) => {
      setProgress(0.1);
      const res = await compressToTargetSize(file, targetBytes);
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-compress-image">
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
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  {t('Target')}: <strong>{formatBytes(targetBytes)}</strong>
                </span>
                <span className="meta-chip">
                  {t('Output dimensions')}:{' '}
                  <strong>
                    {resultInfo.width}×{resultInfo.height} px
                  </strong>
                </span>
              </div>
              {resultInfo.achievedBytes > targetBytes && (
                <div className="error-banner" role="status" style={{ marginBottom: '1rem' }}>
                  {t('The target size could not be reached. The result panel shows the closest available size.')}
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
                  {t('Current size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
                {imgMeta && (
                  <span className="meta-chip">
                    {t('Dimensions')}:{' '}
                    <strong>
                      {imgMeta.width}×{imgMeta.height} px
                    </strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Optimizing to target size...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {decodedImage && imgMeta && (
                    <ImagePreviewPair
                      sourceUrl={sourcePreviewUrl}
                      outputUrl={previewUrl}
                      sourceAlt={t('Original image preview')}
                      outputAlt={t('Target size compression preview')}
                      sourceLabel={t('Original image')}
                      outputLabel={t('Target size preview')}
                      sourceDetails={`${imgMeta.width}×${imgMeta.height} px`}
                      outputDetails={
                        currentPreview
                          ? `${currentPreview.outputWidth}×${currentPreview.outputHeight} px · ${t('Approx. output size: {size}', { size: formatBytes(currentPreview.estimatedBytes) })} · ${t('Quality {quality}%', { quality: Math.round(currentPreview.quality * 100) })}`
                          : undefined
                      }
                      note={t(
                        'This estimate uses a bounded sample. The export uses the original image and may reduce dimensions to meet the target size.',
                      )}
                      pending={previewPending}
                      pendingLabel={t('Preparing preview…')}
                      sourcePending={!!decodedImage && !sourcePreviewUrl && !sourcePreviewError}
                      sourceUnavailable={t('Source preview is unavailable for this image.')}
                      outputUnavailable={
                        previewError
                          ? t('Preview could not be created. Adjust the target size or choose another image.')
                          : t('Preparing preview…')
                      }
                    />
                  )}

                  <Field label={t('Target file size')} hint={t('Specify desired maximum file size')}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={targetValue}
                        onChange={(e) => setTargetValue(Math.max(1, parseFloat(e.target.value) || 1))}
                        className={styles.inputNumber}
                        style={{ flex: 1 }}
                      />
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as SizeUnit)}
                        className="select"
                        style={{ width: '100px' }}
                      >
                        <option value="KB">KB</option>
                        <option value="MB">MB</option>
                      </select>
                    </div>

                    <div className={styles.presetChips}>
                      {PRESETS.map((p) => {
                        const isActive = targetBytes === p.bytes;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`${styles.presetChip} ${isActive ? styles.presetChipActive : ''}`}
                            onClick={() => applyPreset(p)}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different image')}
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      {t('Compress to {value} {unit}', { value: targetValue, unit })}
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
