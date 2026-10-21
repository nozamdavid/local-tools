import { useState, useEffect, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { BatchResults } from '../../../components/BatchResults';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT, decodeImage, imageToCanvas } from '../../../lib/image';
import { formatBytes, replaceExt } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { checkAvifSupport, convertSingleImage } from './convert';
import type { ConverterPreset, OutputFormat, SvgScale } from './types';
import styles from './Converter.module.css';

const ALL_FORMAT_LABELS: Record<OutputFormat, string> = {
  jpg: 'JPG (Standard JPEG)',
  png: 'PNG (Lossless with transparency)',
  webp: 'WEBP (Modern compact web format)',
  gif: 'GIF (Single-frame)',
  bmp: 'BMP (24-bit uncompressed)',
  avif: 'AVIF (Next-generation)',
  jxl: 'JXL (JPEG XL Next-generation)',
};

function isNonNativePreview(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) || /image\/jxl/i.test(file.type) || /\.jxl$/i.test(file.name);
}

export function Converter({ preset }: { preset: ConverterPreset }) {
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

  const formatSelectId = useId();
  const scaleSelectId = useId();

  // Test for AVIF support on mount
  useEffect(() => {
    checkAvifSupport().then(setAvifSupported);
  }, []);

  // Single file original preview
  const rawPreviewUrl = useObjectUrl(files.length === 1 && !isNonNativePreview(files[0]) ? files[0] : null);
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (files.length !== 1 || !isNonNativePreview(files[0])) {
      setCustomPreviewUrl(null);
      return;
    }
    let active = true;
    let createdUrl: string | null = null;

    decodeImage(files[0])
      .then((img) => {
        if (!active) return;
        const canvas = imageToCanvas(img);
        canvas.toBlob((blob) => {
          if (!active || !blob) return;
          createdUrl = URL.createObjectURL(blob);
          setCustomPreviewUrl(createdUrl);
        }, 'image/png');
      })
      .catch(() => {
        // If decoding preview fails, leave preview empty
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [files]);

  const previewUrl = rawPreviewUrl || customPreviewUrl;

  const handleFiles = (incoming: File[]) => {
    if (!incoming || incoming.length === 0) return;
    setFiles(incoming);
    setStatus('idle');
    setProgress(0);
    setCurrentIndex(0);
    setOutputResults([]);
    setFailedResults([]);
  };

  const handleReset = () => {
    setFiles([]);
    setStatus('idle');
    setProgress(0);
    setCurrentIndex(0);
    setOutputResults([]);
    setFailedResults([]);
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
        wrongInputNote = `Note: "${mismatched[0].name}" is not a ${label} file, but it will still be converted.`;
      } else {
        wrongInputNote = `Note: ${mismatched.length} files are not ${label} files, but they will still be converted.`;
      }
    }
  }

  // Available format options
  const allowed = preset.allowedFormats || (['jpg', 'png', 'webp', 'gif', 'bmp', 'avif', 'jxl'] as OutputFormat[]);
  const formatOptions = allowed
    .filter((fmt) => fmt !== 'avif' || avifSupported)
    .map((fmt) => ({
      value: fmt,
      label: ALL_FORMAT_LABELS[fmt],
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
          label={preset.dropLabel || 'Choose images or drag them here'}
          hint={preset.dropHint || '100% private. Files never leave your browser.'}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {/* Metadata Chips */}
          <div className="meta-chips">
            {files.length === 1 ? (
              <>
                <span className="meta-chip">
                  Name: <strong>{files[0].name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(files[0].size)}</strong>
                </span>
              </>
            ) : (
              <>
                <span className="meta-chip">
                  Files: <strong>{files.length} images</strong>
                </span>
                <span className="meta-chip">
                  Total size: <strong>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</strong>
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

          {/* Idle: Controls & Options */}
          {status === 'idle' && (
            <div style={{ marginTop: '1.25rem' }}>
              <Field label="Output format" hint="Select the image format to convert to.">
                <Select
                  id={formatSelectId}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                  options={formatOptions}
                />
              </Field>

              {format === 'jxl' && (
                <div style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} />
                    <span>Lossless compression</span>
                  </label>
                  <p style={{ margin: '0.35rem 0 0 1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Encodes static SDR images. Animation and HDR gain maps are not preserved.
                  </p>
                </div>
              )}

              {showQuality && (
                <Field
                  label={`Quality (${quality}%)`}
                  hint={
                    format === 'jpg'
                      ? 'Controls JPEG compression quality. Higher means cleaner image, larger file.'
                      : format === 'jxl'
                        ? 'Controls JPEG XL compression quality (1-100).'
                        : 'Compression quality slider (1-100).'
                  }
                >
                  <Slider value={quality} min={1} max={100} step={1} unit="%" onChange={setQuality} />
                </Field>
              )}

              {showBgColor && (
                <Field label="Background colour" hint="Used to fill transparent areas when flattening transparency into JPG or BMP.">
                  <div className={styles.colorPickerRow}>
                    <input
                      type="color"
                      aria-label="Background colour picker"
                      className={styles.colorInput}
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                    />
                    <span className={styles.colorHex}>{bgColor.toUpperCase()}</span>
                  </div>
                </Field>
              )}

              {preset.hasScaleOption && (
                <>
                  <Field label="Output scale / width" hint="SVGs are vector graphics that can be rendered crisply at any size.">
                    <Select
                      id={scaleSelectId}
                      value={svgScale}
                      onChange={(e) => setSvgScale(e.target.value as SvgScale)}
                      options={[
                        { value: '1x', label: '1× (Original size)' },
                        { value: '2x', label: '2× (Double resolution)' },
                        { value: '4x', label: '4× (High resolution)' },
                        { value: 'custom', label: 'Custom width' },
                      ]}
                    />
                  </Field>

                  {svgScale === 'custom' && (
                    <Field label="Custom width (px)" hint="Height will scale proportionally.">
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

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Choose different {files.length === 1 ? 'file' : 'files'}
                </Button>
                <Button variant="primary" onClick={handleConvert}>
                  Convert {files.length === 1 ? 'image' : `${files.length} images`}
                </Button>
              </div>
            </div>
          )}

          {/* Processing */}
          {status === 'processing' && (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar
                value={progress}
                label={`Converting ${files[currentIndex]?.name || 'image'} (${currentIndex + 1} of ${files.length})...`}
              />
            </div>
          )}

          {/* Done */}
          {status === 'done' && (
            <div style={{ marginTop: '1.25rem' }}>
              {/* Failed Items Banner */}
              {failedResults.length > 0 && (
                <div className="error-banner" role="alert">
                  <strong>
                    {failedResults.length} file{failedResults.length > 1 ? 's' : ''} failed to convert:
                  </strong>
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
                    beforePreview={previewUrl ? <img src={previewUrl} alt={files[0].name} className="preview-media" /> : null}
                    onReset={handleReset}
                  />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Try another file
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
                        Start over
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
