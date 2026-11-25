import { useState, useEffect, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { BatchResults } from '../../../components/BatchResults';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { IMAGE_ACCEPT, decodeImage } from '../../../lib/image';
import { formatBytes, replaceExt } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { checkAvifSupport, convertPreviewImage, convertSingleImage } from './convert';
import type { ConverterPreset, OutputFormat, SvgScale } from './types';
import styles from './Converter.module.css';
import { createBoundedPngPreview } from '../_basic/previews';
import { ImagePreviewPair } from '../_basic/ImagePreviewPair';

const ALL_FORMAT_LABELS: Record<OutputFormat, string> = {
  jpg: 'JPG',
  png: 'PNG (lossless, transparency)',
  webp: 'WebP',
  gif: 'GIF (single frame)',
  bmp: 'BMP (24-bit, uncompressed)',
  avif: 'AVIF',
  jxl: 'JPEG XL',
};

function isNonNativePreview(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) || /image\/jxl/i.test(file.type) || /\.jxl$/i.test(file.name);
}

export function Converter({ preset }: { preset: ConverterPreset }) {
  const { t } = useI18n();
  const meta = getToolMeta(preset.toolId);

  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<OutputFormat>(preset.defaultFormat);
  const [quality, setQuality] = useState<number>(90);
  const [lossless, setLossless] = useState<boolean>(false);
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [svgScale, setSvgScale] = useState<SvgScale>('1x');
  const [customWidth, setCustomWidth] = useState<number>(1920);

  const [avifSupported, setAvifSupported] = useState<boolean>(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const [outputResults, setOutputResults] = useState<{ name: string; blob: Blob; originalSize: number }[]>([]);
  const [failedResults, setFailedResults] = useState<{ name: string; error: string }[]>([]);
  const [customPreview, setCustomPreview] = useState<{ file: File; blob: Blob } | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [targetPreview, setTargetPreview] = useState<{
    file: File;
    key: string;
    url: string;
    outputWidth: number;
    outputHeight: number;
    isEncodedAppearance: boolean;
  } | null>(null);
  const [targetPreviewPending, setTargetPreviewPending] = useState(false);
  const [targetPreviewError, setTargetPreviewError] = useState(false);

  const formatSelectId = useId();
  const scaleSelectId = useId();

  // Test for AVIF support on mount
  useEffect(() => {
    checkAvifSupport().then(setAvifSupported);
  }, []);

  const previewFile = files[0] || null;
  const rawPreviewUrl = useObjectUrl(previewFile && !isNonNativePreview(previewFile) ? previewFile : null);
  const customPreviewUrl = useObjectUrl(customPreview?.file === previewFile ? customPreview.blob : null);
  const sourcePreviewUrl = rawPreviewUrl || customPreviewUrl;

  useEffect(() => {
    if (!previewFile || !isNonNativePreview(previewFile)) {
      setCustomPreview(null);
      setSourcePreviewError(false);
      return;
    }
    let active = true;
    setCustomPreview(null);
    setSourcePreviewError(false);
    decodeImage(previewFile)
      .then((img) => {
        if (!active) return;
        return createBoundedPngPreview(img, img.naturalWidth || img.width, img.naturalHeight || img.height).then((blob) => {
          if (active) setCustomPreview({ file: previewFile, blob });
        });
      })
      .catch(() => {
        if (active) setSourcePreviewError(true);
      });

    return () => {
      active = false;
    };
  }, [previewFile]);

  const targetPreviewKey = `${format}:${quality}:${lossless}:${bgColor}:${svgScale}:${customWidth}`;
  const currentTargetPreview = targetPreview?.file === previewFile && targetPreview.key === targetPreviewKey ? targetPreview : null;
  const targetPreviewUrl = currentTargetPreview?.url;

  useEffect(() => {
    if (!previewFile || status !== 'idle') {
      setTargetPreviewPending(false);
      return;
    }
    let active = true;
    let createdUrl: string | null = null;
    setTargetPreviewPending(true);
    setTargetPreviewError(false);
    const timeout = window.setTimeout(async () => {
      try {
        const result = await convertPreviewImage({
          file: previewFile,
          format,
          quality,
          lossless,
          bgColor,
          svgScale,
          customWidth,
        });
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setTargetPreview({
          file: previewFile,
          key: targetPreviewKey,
          url: createdUrl,
          outputWidth: result.outputWidth,
          outputHeight: result.outputHeight,
          isEncodedAppearance: result.isEncodedAppearance,
        });
      } catch {
        if (active) setTargetPreviewError(true);
      } finally {
        if (active) setTargetPreviewPending(false);
      }
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [bgColor, customWidth, format, lossless, previewFile, quality, status, svgScale, targetPreviewKey]);

  const handleFiles = (incoming: File[]) => {
    if (!incoming || incoming.length === 0) return;
    setFiles(incoming);
    setStatus('idle');
    setProgress(0);
    setCurrentIndex(0);
    setOutputResults([]);
    setFailedResults([]);
    setCustomPreview(null);
    setSourcePreviewError(false);
    setTargetPreview(null);
    setTargetPreviewPending(false);
    setTargetPreviewError(false);
  };

  const handleReset = () => {
    setFiles([]);
    setStatus('idle');
    setProgress(0);
    setCurrentIndex(0);
    setOutputResults([]);
    setFailedResults([]);
    setCustomPreview(null);
    setSourcePreviewError(false);
    setTargetPreview(null);
    setTargetPreviewPending(false);
    setTargetPreviewError(false);
    setLossless(false);
    setFormat(preset.defaultFormat);
  };

  // Check wrong input format for note
  let wrongInputNote: string | null = null;
  if (preset.expectedFormats && preset.expectedFormats.length > 0 && files.length > 0) {
    const mismatched = files.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      const type = f.type.toLowerCase();
      return !preset.expectedFormats!.some((exp) => ext === exp || type.includes(exp));
    });

    if (mismatched.length > 0) {
      const label = preset.expectedLabel || preset.expectedFormats.map((e) => e.toUpperCase()).join('/');
      if (mismatched.length === 1) {
        wrongInputNote = t('Note: "{filename}" is not a {format} file, but it will still be converted.', {
          filename: mismatched[0].name,
          format: label,
        });
      } else {
        wrongInputNote = t('Note: {count} files are not {format} files, but they will still be converted.', {
          count: mismatched.length,
          format: label,
        });
      }
    }
  }

  // Available format options
  const allowed = preset.allowedFormats || (['jpg', 'png', 'webp', 'gif', 'bmp', 'avif', 'jxl'] as OutputFormat[]);
  const formatOptions = allowed
    .filter((fmt) => fmt !== 'avif' || avifSupported)
    .map((fmt) => ({
      value: fmt,
      label: t(ALL_FORMAT_LABELS[fmt]),
    }));

  const handleConvert = async () => {
    if (files.length === 0 || status === 'processing') return;

    setStatus('processing');
    setProgress(0);
    setCurrentIndex(0);

    const successful: { name: string; blob: Blob; originalSize: number }[] = [];
    const failed: { name: string; error: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentIndex(i);
      setProgress(i / files.length);

      try {
        const blob = await convertSingleImage({
          file,
          format,
          quality,
          lossless,
          bgColor,
          svgScale,
          customWidth,
        });
        const name = replaceExt(file.name, format);
        successful.push({
          name,
          blob,
          originalSize: file.size,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error during conversion';
        failed.push({
          name: file.name,
          error: errorMsg,
        });
      }

      setProgress((i + 1) / files.length);
    }

    setOutputResults(successful);
    setFailedResults(failed);
    setStatus('done');
  };

  const showQuality = format === 'jpg' || format === 'webp' || format === 'avif' || (format === 'jxl' && !lossless);
  const showBgColor = format === 'jpg' || format === 'bmp';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={preset.toolId}>
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple={true}
          label={t(preset.dropLabel || 'Choose images or drag them here')}
          hint={t(preset.dropHint || '100% private. Files never leave your browser.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {/* Metadata Chips */}
          <div className="meta-chips">
            {files.length === 1 ? (
              <>
                <span className="meta-chip">
                  {t('Name')}: <strong>{files[0].name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(files[0].size)}</strong>
                </span>
              </>
            ) : (
              <>
                <span className="meta-chip">
                  {t('Files')}:{' '}
                  <strong>
                    {files.length} {t('images')}
                  </strong>
                </span>
                <span className="meta-chip">
                  {t('Total size')}: <strong>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</strong>
                </span>
              </>
            )}
          </div>

          {/* Wrong input note if applicable */}
          {wrongInputNote && (
            <div className={styles.noteBanner} role="status">
              <span className={styles.noteIcon} aria-hidden="true">
                ℹ️
              </span>
              <span>{wrongInputNote}</span>
            </div>
          )}

          {status === 'idle' && previewFile && (
            <ImagePreviewPair
              sourceUrl={sourcePreviewUrl}
              outputUrl={targetPreviewUrl}
              sourceAlt={t('Source image preview: {filename}', { filename: previewFile.name })}
              outputAlt={t('Converted image preview: {filename}', { filename: previewFile.name })}
              sourceLabel={files.length > 1 ? t('Source image (first of {count})', { count: files.length }) : t('Source image')}
              outputLabel={t('Target appearance')}
              sourceDetails={`${previewFile.name} · ${formatBytes(previewFile.size)}`}
              outputDetails={
                currentTargetPreview ? `${currentTargetPreview.outputWidth}×${currentTargetPreview.outputHeight} px` : undefined
              }
              note={
                currentTargetPreview && !currentTargetPreview.isEncodedAppearance
                  ? t(
                      'The browser cannot decode this encoded preview, so the target canvas appearance is shown. Compression detail may differ.',
                    )
                  : t('This preview encodes a bounded sample. Fine detail and final file size can differ from the full-resolution export.')
              }
              pending={targetPreviewPending}
              pendingLabel={t('Preparing preview…')}
              sourcePending={!sourcePreviewUrl && !sourcePreviewError}
              sourceUnavailable={t('Source preview is unavailable for this image.')}
              outputUnavailable={
                targetPreviewError
                  ? t('Preview could not be created for this format. The conversion is still available.')
                  : t('Preparing preview…')
              }
            />
          )}

          {/* Idle: Controls & Options */}
          {status === 'idle' && (
            <div style={{ marginTop: '1.25rem' }}>
              <Field label={t('Convert to')}>
                <Select
                  id={formatSelectId}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                  options={formatOptions}
                />
              </Field>

              {format === 'jxl' && (
                <div className={styles.noteBanner} role="status">
                  <span className={styles.noteIcon} aria-hidden="true">
                    ℹ️
                  </span>
                  <span>{t('JPEG XL exports static SDR images. Animation and HDR gain maps are not preserved.')}</span>
                </div>
              )}

              {preset.hasScaleOption && (
                <>
                  <Field label={t('Output scale / width')} hint={t('SVGs are vector graphics that can be rendered crisply at any size.')}>
                    <Select
                      id={scaleSelectId}
                      value={svgScale}
                      onChange={(e) => setSvgScale(e.target.value as SvgScale)}
                      options={[
                        { value: '1x', label: t('1× (Original size)') },
                        { value: '2x', label: t('2× (Double resolution)') },
                        { value: '4x', label: t('4× (High resolution)') },
                        { value: 'custom', label: t('Custom width') },
                      ]}
                    />
                  </Field>

                  {svgScale === 'custom' && (
                    <Field label={t('Custom width (px)')} hint={t('Height will scale proportionally.')}>
                      <input
                        type="number"
                        className={styles.customWidthInput}
                        min={1}
                        max={16384}
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      />
                    </Field>
                  )}
                </>
              )}

              <details className="tool-options">
                <summary>{t('Advanced options')}</summary>
                <div className="tool-options-body">
                  {format === 'jxl' && (
                    <div style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} />
                        <span>{t('Lossless compression')}</span>
                      </label>
                    </div>
                  )}

                  {showQuality && (
                    <Field
                      label={t('Quality ({quality}%)', { quality })}
                      hint={
                        format === 'jpg'
                          ? t('Higher quality keeps more detail and creates larger files.')
                          : format === 'jxl'
                            ? t('Controls JPEG XL compression quality (1-100).')
                            : t('Higher quality keeps more detail and creates larger files.')
                      }
                    >
                      <Slider value={quality} min={1} max={100} step={1} unit="%" onChange={setQuality} />
                    </Field>
                  )}

                  {showBgColor && (
                    <Field label={t('Background colour')} hint={t('Fills transparent areas when converting to JPG or BMP.')}>
                      <div className={styles.colorPickerRow}>
                        <input
                          type="color"
                          aria-label={t('Background colour picker')}
                          className={styles.colorInput}
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                        />
                        <span className={styles.colorHex}>{bgColor.toUpperCase()}</span>
                      </div>
                    </Field>
                  )}
                </div>
              </details>

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {files.length === 1 ? t('Choose different file') : t('Choose different files')}
                </Button>
                <Button variant="primary" onClick={handleConvert}>
                  {files.length === 1 ? t('Convert image') : t('Convert {count} images', { count: files.length })}
                </Button>
              </div>
            </div>
          )}

          {/* Processing */}
          {status === 'processing' && (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar
                value={progress}
                label={t('Converting {filename} ({current} of {total})...', {
                  filename: files[currentIndex]?.name || t('image'),
                  current: currentIndex + 1,
                  total: files.length,
                })}
              />
            </div>
          )}

          {/* Done */}
          {status === 'done' && (
            <div style={{ marginTop: '1.25rem' }}>
              {/* Failed Items Banner */}
              {failedResults.length > 0 && (
                <div className="error-banner" role="alert">
                  <strong>{t('{count} files failed to convert:', { count: failedResults.length })}</strong>
                  <ul className={styles.failedList}>
                    {failedResults.map((f, i) => (
                      <li key={i}>
                        <strong>{f.name}</strong>: {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Single File Results */}
              {files.length === 1 ? (
                outputResults.length === 1 ? (
                  <ResultPanel
                    blob={outputResults[0].blob}
                    filename={outputResults[0].name}
                    kind="image"
                    originalSize={outputResults[0].originalSize}
                    beforePreview={sourcePreviewUrl ? <img src={sourcePreviewUrl} alt={files[0].name} className="preview-media" /> : null}
                    onReset={handleReset}
                  />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Try another file')}
                    </Button>
                  </div>
                )
              ) : (
                /* Multiple Files Results */
                <div>
                  {outputResults.length > 0 ? (
                    <BatchResults items={outputResults} onReset={handleReset} />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        {t('Start over')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
