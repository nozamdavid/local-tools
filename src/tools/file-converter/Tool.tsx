import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { BatchResults, type BatchResultItem } from '../../components/BatchResults';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { formatBytes } from '../../lib/format';
import { detectFormat, type DetectedFormat, type FormatFamily } from './detect';
import { getTargetFormats, type TargetFormat } from './matrix';
import { executeConversion } from './engines';
import styles from './Tool.module.css';

const FAMILY_ICONS: Record<FormatFamily, string> = {
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  document: '📄',
  text: '📝',
  unknown: '❓',
};

const FAMILY_LABELS: Record<FormatFamily, string> = {
  image: 'Image Formats',
  video: 'Video Formats',
  audio: 'Audio Formats',
  document: 'Document Formats',
  text: 'Text & Data Formats',
  unknown: 'Other',
};

export default function FileConverterTool() {
  const meta = getToolMeta('file-converter');

  const [file, setFile] = useState<File | null>(null);
  const [detecting, setDetecting] = useState<boolean>(false);
  const [detected, setDetected] = useState<DetectedFormat | null>(null);
  const [targetFamilies, setTargetFamilies] = useState<Record<FormatFamily, TargetFormat[]> | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<TargetFormat | null>(null);

  // Conversion options
  const [quality, setQuality] = useState<number>(90);
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [dpi, setDpi] = useState<number>(150);
  const [svgScale, setSvgScale] = useState<'1x' | '2x' | '4x'>('2x');
  const [bitrate, setBitrate] = useState<string>('192k');

  // Job progress & results
  const [converting, setConverting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<{ name: string; blob: Blob } | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResultItem[] | null>(null);

  const qualityId = useId();
  const dpiId = useId();
  const svgScaleId = useId();
  const bitrateId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const chosen = files[0];
    setFile(chosen);
    setDetecting(true);
    setDetected(null);
    setTargetFamilies(null);
    setSelectedTarget(null);
    setSingleResult(null);
    setBatchResults(null);
    setError(null);
    setProgress(0);

    try {
      const format = await detectFormat(chosen);
      setDetected(format);

      if (format.family !== 'unknown') {
        const targets = await getTargetFormats(format, chosen);
        setTargetFamilies(targets);

        // Pick first available target by default
        const first = targets.image[0] || targets.video[0] || targets.audio[0] || targets.document[0] || targets.text[0] || null;
        setSelectedTarget(first);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect file');
    } finally {
      setDetecting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setDetected(null);
    setTargetFamilies(null);
    setSelectedTarget(null);
    setSingleResult(null);
    setBatchResults(null);
    setError(null);
    setConverting(false);
    setProgress(0);
  };

  const handleConvert = async () => {
    if (!file || !detected || !selectedTarget) return;

    setConverting(true);
    setProgress(0);
    setError(null);

    try {
      const result = await executeConversion({
        file,
        detected,
        target: selectedTarget,
        quality,
        bgColor,
        dpi,
        svgScale,
        bitrate,
        onProgress: setProgress,
      });

      if (result.type === 'single') {
        setSingleResult({ name: result.name, blob: result.blob });
      } else {
        setBatchResults(result.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const renderResultKind = (target: TargetFormat): 'video' | 'audio' | 'image' | 'text' => {
    if (target.family === 'video') return 'video';
    if (target.family === 'audio') return 'audio';
    if (target.family === 'image') return 'image';
    return 'text';
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="file-converter">
      {!file ? (
        <FileDrop
          accept="*"
          label="Choose any file or drag it here"
          hint="Detects real file format from content signatures. 100% on-device private conversion."
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {error && <div className="error-banner">{error}</div>}

          {/* 1. Results View */}
          {singleResult ? (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Convert another file
                </Button>
              </div>
              <ResultPanel
                blob={singleResult.blob}
                filename={singleResult.name}
                kind={selectedTarget ? renderResultKind(selectedTarget) : 'text'}
                originalSize={file.size}
                onReset={handleReset}
              />
            </div>
          ) : batchResults ? (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Convert another file
                </Button>
              </div>
              <BatchResults items={batchResults} onReset={handleReset} />
            </div>
          ) : detecting ? (
            <ProgressBar value={0.5} label="Detecting real file format from content signatures..." />
          ) : converting ? (
            <ProgressBar value={progress} label={`Converting to ${selectedTarget?.label || 'target format'}...`} />
          ) : detected ? (
            <div className={styles.container}>
              {/* 2. Detection Card */}
              <div className={styles.detectionCard}>
                <div className={styles.detectionHeader}>
                  <div className={styles.detectionIcon}>{FAMILY_ICONS[detected.family]}</div>
                  <div className={styles.detectionDetails}>
                    <div className={styles.detectedTitle}>
                      <span>{detected.label}</span>
                      <span className="badge badge-brand" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
                        {detected.family}
                      </span>
                    </div>
                    <div className={styles.detectedMeta}>
                      <span>
                        Original file: <strong>{file.name}</strong>
                      </span>
                      <span>·</span>
                      <span>{formatBytes(file.size)}</span>
                      <span>·</span>
                      <span>MIME: {detected.mime}</span>
                    </div>
                  </div>
                </div>

                {/* Extension Mismatch Warning */}
                {detected.extensionMismatch && (
                  <div className={styles.mismatchBanner}>
                    <span className={styles.mismatchIcon}>⚠️</span>
                    <div>
                      <strong>File extension mismatch:</strong> This file is named <code>.{detected.actualExtension}</code>, but its content
                      is actually <strong>{detected.label}</strong>. Loconvert will convert using its true detected format.
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Unknown/Unsupported Format Message */}
              {detected.family === 'unknown' || !targetFamilies ? (
                <div className={styles.unsupportedCard}>
                  <div className={styles.unsupportedTitle}>Unsupported file format</div>
                  <p className={styles.unsupportedText}>
                    This file could not be recognized as a supported media or document type. Supported formats include:
                    <br />• <strong>Images:</strong> PNG, JPG, WebP, GIF, BMP, TIFF, ICO, AVIF, HEIC, JXL, SVG
                    <br />• <strong>Videos:</strong> MP4, WebM, MKV, AVI, MOV, FLV, MPEG-TS, 3GP, WMV, OGV
                    <br />• <strong>Audio:</strong> MP3, WAV, M4A, FLAC, OGG, Opus, AIFF, WMA
                    <br />• <strong>Documents:</strong> PDF, Word (DOCX)
                    <br />• <strong>Text &amp; Data:</strong> JSON, CSV, TSV, Plain Text
                  </p>
                  <div>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose a different file
                    </Button>
                  </div>
                </div>
              ) : (
                /* 4. Supported: Target Format Selector */
                <div>
                  <div className={styles.sectionTitle}>Convert to:</div>
                  <div className={styles.targetGrid}>
                    {(['image', 'video', 'audio', 'document', 'text'] as FormatFamily[]).map((fam) => {
                      const targets = targetFamilies[fam];
                      if (!targets || targets.length === 0) return null;

                      return (
                        <div key={fam} className={styles.familyGroup}>
                          <div className={styles.familyTitle}>
                            <span style={{ marginRight: '0.4rem' }}>{FAMILY_ICONS[fam]}</span>
                            {FAMILY_LABELS[fam]}
                          </div>
                          <div className={styles.chipRow}>
                            {targets.map((tgt) => {
                              const isActive = selectedTarget?.id === tgt.id;
                              return (
                                <button
                                  key={tgt.id}
                                  type="button"
                                  className={`${styles.targetChip} ${isActive ? styles.targetChipActive : ''}`}
                                  onClick={() => setSelectedTarget(tgt)}
                                >
                                  <span className={styles.targetLabel}>{tgt.label}</span>
                                  {tgt.description && <span className={styles.targetDesc}>{tgt.description}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 5. Per-Target Options */}
                  {selectedTarget && (
                    <div className={styles.optionsCard}>
                      <div className={styles.optionsTitle}>Conversion options for {selectedTarget.label}</div>

                      {/* Lossy image quality */}
                      {['jpg', 'webp', 'avif', 'jxl'].includes(selectedTarget.id) && (
                        <Field
                          label={`Quality (${quality}%)`}
                          hint={
                            selectedTarget.id === 'jxl'
                              ? 'Controls JPEG XL compression quality (100 is lossless).'
                              : 'Lower values produce smaller files.'
                          }
                        >
                          <input
                            id={qualityId}
                            type="range"
                            min="10"
                            max="100"
                            value={quality}
                            onChange={(e) => setQuality(Number(e.target.value))}
                            style={{ width: '100%' }}
                          />
                        </Field>
                      )}

                      {selectedTarget.id === 'jxl' && (
                        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Encodes static SDR images. Animation and HDR gain maps are not preserved.
                        </p>
                      )}

                      {/* Flatten background for JPG / BMP */}
                      {['jpg', 'bmp'].includes(selectedTarget.id) && (
                        <Field label="Background colour" hint="Used to flatten any transparent areas.">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input
                              type="color"
                              value={bgColor}
                              onChange={(e) => setBgColor(e.target.value)}
                              style={{ width: '40px', height: '36px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <Button variant={bgColor === '#ffffff' ? 'primary' : 'secondary'} onClick={() => setBgColor('#ffffff')}>
                                White
                              </Button>
                              <Button variant={bgColor === '#000000' ? 'primary' : 'secondary'} onClick={() => setBgColor('#000000')}>
                                Black
                              </Button>
                            </div>
                          </div>
                        </Field>
                      )}

                      {/* SVG scale option */}
                      {detected.id === 'svg' && (
                        <Field label="Raster scale" hint="Scale vector graphics for high resolution.">
                          <Select
                            id={svgScaleId}
                            value={svgScale}
                            onChange={(e) => setSvgScale(e.target.value as '1x' | '2x' | '4x')}
                            options={[
                              { value: '1x', label: '1× (Original size)' },
                              { value: '2x', label: '2× (Crisp retina)' },
                              { value: '4x', label: '4× (Ultra high-res)' },
                            ]}
                          />
                        </Field>
                      )}

                      {/* PDF to Image DPI */}
                      {detected.id === 'pdf' && ['png', 'jpg'].includes(selectedTarget.id) && (
                        <Field label="Rendering DPI" hint="Higher DPI results in sharper text and larger images.">
                          <Select
                            id={dpiId}
                            value={String(dpi)}
                            onChange={(e) => setDpi(Number(e.target.value))}
                            options={[
                              { value: '72', label: '72 DPI (Standard screen)' },
                              { value: '150', label: '150 DPI (Balanced / Default)' },
                              { value: '300', label: '300 DPI (High-res print quality)' },
                            ]}
                          />
                        </Field>
                      )}

                      {/* Audio bitrate */}
                      {['mp3', 'm4a', 'ogg', 'opus'].includes(selectedTarget.id) && (
                        <Field label="Audio bitrate" hint="Higher bitrate preserves finer audio quality.">
                          <Select
                            id={bitrateId}
                            value={bitrate}
                            onChange={(e) => setBitrate(e.target.value)}
                            options={[
                              { value: '96k', label: '96 kbps (Voice / compact)' },
                              { value: '128k', label: '128 kbps (Standard)' },
                              { value: '192k', label: '192 kbps (High quality)' },
                              { value: '256k', label: '256 kbps (Very high quality)' },
                            ]}
                          />
                        </Field>
                      )}

                      {/* Convert Action Button */}
                      <div className="action-buttons" style={{ marginTop: '2rem' }}>
                        <Button variant="secondary" onClick={handleReset}>
                          Choose a different file
                        </Button>
                        <Button variant="primary" onClick={handleConvert}>
                          Convert to {selectedTarget.label}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </ToolPage>
  );
}
