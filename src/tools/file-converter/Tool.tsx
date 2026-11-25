import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { BatchResults, type BatchResultItem } from '../../components/BatchResults';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { formatBytes } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { detectFormat, translateDetectedFormatLabel, type DetectedFormat, type FormatFamily } from './detect';
import { getTargetFormats, type TargetFormat } from './matrix';
import { executeConversion } from './engines';
import { OFFICE_FORMATS } from './office';
import styles from './Tool.module.css';

export default function FileConverterTool() {
  const { t } = useI18n();
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

  const errorText = (message: string) => {
    let match = message.match(/^Conversion from (.+) to (.+) is not supported\.$/);
    if (match) return t('Conversion from {source} to {target} is not supported.', { source: match[1], target: match[2] });
    match = message.match(/^Spreadsheet export exceeds the ([\d,]+)-row limit\.$/);
    if (match) return t('Spreadsheet export exceeds the {count}-row limit.', { count: match[1] });
    match = message.match(/^Spreadsheet export exceeds the ([\d,]+)-cell limit\.$/);
    if (match) return t('Spreadsheet export exceeds the {count}-cell limit.', { count: match[1] });
    match = message.match(/^(.+) exceeds the 32 MB XML limit\.$/);
    if (match) return t('{label} exceeds the 32 MB XML limit.', { label: match[1] });
    match = message.match(/^(.+) uses a DTD or entity declaration, which is not supported\.$/);
    if (match) return t('{label} uses a DTD or entity declaration, which is not supported.', { label: match[1] });
    match = message.match(/^Malformed XML in (.+): (.+)\.$/);
    if (match) return t('Malformed XML in {label}: {message}.', { label: match[1], message: match[2] });
    match = message.match(/^(.+) contains too many XML nodes\.$/);
    if (match) return t('{label} contains too many XML nodes.', { label: match[1] });
    match = message.match(/^(.+) must contain one XML document element\.$/);
    if (match) return t('{label} must contain one XML document element.', { label: match[1] });
    match = message.match(/^Spreadsheet repeat count must be between 1 and ([\d,]+)\.$/);
    if (match) return t('Spreadsheet repeat count must be between 1 and {count}.', { count: match[1] });
    match = message.match(/^Office package contains more than ([\d,]+) entries\.$/);
    if (match) return t('Office package contains more than {count} entries.', { count: match[1] });
    match = message.match(/^Office package entry (.+) exceeds the 32 MB uncompressed limit\.$/);
    if (match) return t('Office package entry {path} exceeds the 32 MB uncompressed limit.', { path: match[1] });
    match = message.match(/^Could not decompress office package entry (.+): (.+?)\.?$/);
    if (match) return t('Could not decompress office package entry {path}: {message}.', { path: match[1], message: match[2] });
    match = message.match(/^Could not read office package: (.+)\.$/);
    if (match) return t('Could not read office package: {message}.', { message: match[1] });
    match = message.match(/^Office package is missing (.+)\.$/);
    if (match) return t('Office package is missing {path}.', { path: match[1] });
    match = message.match(/^Corrupt office package entry (.+): checksum mismatch\.$/);
    if (match) return t('Corrupt office package entry {path}: checksum mismatch.', { path: match[1] });
    match = message.match(/^Office package entry (.+) is not valid UTF-8 XML\.$/);
    if (match) return t('Office package entry {path} is not valid UTF-8 XML.', { path: match[1] });
    match = message.match(/^Unsupported OpenDocument input format: (.+)\.$/);
    if (match) return t('Unsupported OpenDocument input format: {format}.', { format: match[1] });
    match = message.match(/^OpenDocument body does not contain (.+) content\.$/);
    if (match) return t('OpenDocument body does not contain {family} content.', { family: match[1] });
    match = message.match(/^OpenDocument (.+) cannot be exported to (.+)\.$/);
    if (match) return t('OpenDocument {family} cannot be exported to {target}.', { family: match[1], target: match[2] });
    match = message.match(/^EPUB cannot be exported to (.+)\.$/);
    if (match) return t('EPUB cannot be exported to {target}.', { target: match[1] });
    match = message.match(/^VSDX cannot be exported to (.+)\.$/);
    if (match) return t('VSDX cannot be exported to {target}.', { target: match[1] });
    match = message.match(/^Office conversion from (.+) to (.+) is not supported\.$/);
    if (match) return t('Office conversion from {source} to {target} is not supported.', { source: match[1], target: match[2] });
    return t(message);
  };
  const [singleResult, setSingleResult] = useState<{ name: string; blob: Blob } | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResultItem[] | null>(null);

  const qualityId = useId();
  const dpiId = useId();
  const svgScaleId = useId();
  const bitrateId = useId();
  const hasAvailableTargets = targetFamilies ? Object.values(targetFamilies).some((targets) => targets.length > 0) : false;
  const familyLabels: Record<FormatFamily, string> = {
    image: t('Image Formats'),
    video: t('Video Formats'),
    audio: t('Audio Formats'),
    document: t('Document Formats'),
    text: t('Text & Data Formats'),
    unknown: t('Other'),
  };

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
          label={t('Choose any file or drag it here')}
          hint={t('Detect the file type and available conversions. Files stay on your device.')}
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {error && <div className="error-banner">{errorText(error)}</div>}

          {/* 1. Results View */}
          {singleResult ? (
            <ResultPanel
              blob={singleResult.blob}
              filename={singleResult.name}
              kind={selectedTarget ? renderResultKind(selectedTarget) : 'text'}
              originalSize={file.size}
              onReset={handleReset}
            />
          ) : batchResults ? (
            <BatchResults items={batchResults} onReset={handleReset} />
          ) : detecting ? (
            <ProgressBar value={0.5} label={t('Detecting real file format from content signatures...')} />
          ) : converting ? (
            <ProgressBar value={progress} label={t('Converting to {format}...', { format: selectedTarget?.label || t('target format') })} />
          ) : detected ? (
            <div className={styles.container}>
              {/* 2. Detection Card */}
              <div className={styles.detectionCard}>
                <div className={styles.detectionHeader}>
                  <div className={styles.detectionDetails}>
                    <div className={styles.detectedTitle}>
                      <span>{translateDetectedFormatLabel(detected.label, t)}</span>
                    </div>
                    <div className={styles.detectedMeta}>
                      <span>
                        <strong>{file.name}</strong>
                      </span>
                      <span>·</span>
                      <span>{formatBytes(file.size)}</span>
                    </div>
                  </div>
                </div>

                {/* Extension Mismatch Warning */}
                {detected.extensionMismatch && (
                  <div className={styles.mismatchBanner}>
                    <span className={styles.mismatchIcon}>⚠️</span>
                    <div>
                      <strong>{t('File extension mismatch:')}</strong>{' '}
                      {t(
                        'This file is named .{extension}, but its content is actually {format}. Loconvert will convert using its true detected format.',
                        { extension: detected.actualExtension, format: translateDetectedFormatLabel(detected.label, t) },
                      )}
                    </div>
                  </div>
                )}
                {(detected.detectionNote || OFFICE_FORMATS[detected.id]?.limitation) && (
                  <div className={styles.mismatchBanner}>
                    <span className={styles.mismatchIcon}>ℹ️</span>
                    <div>
                      {OFFICE_FORMATS[detected.id]?.limitation && (
                        <>
                          <strong>{t('Conversion limitation:')}</strong> {t(OFFICE_FORMATS[detected.id].limitation ?? '')}
                        </>
                      )}
                      {detected.detectionNote && (
                        <>
                          {OFFICE_FORMATS[detected.id]?.limitation && <br />}
                          <strong>{t('Detection note:')}</strong> {t(detected.detectionNote)}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Unknown/Unsupported Format Message */}
              {detected.family === 'unknown' || !targetFamilies ? (
                <div className={styles.unsupportedCard}>
                  <div className={styles.unsupportedTitle}>{t('Unsupported file format')}</div>
                  <p className={styles.unsupportedText}>
                    {t('This file could not be recognized. Detected formats include:')}
                    <br />• <strong>{t('Images:')}</strong> PNG, JPG, WebP, GIF, BMP, TIFF, ICO, AVIF, HEIC, JXL, SVG
                    <br />• <strong>{t('Videos:')}</strong> MP4, WebM, MKV, AVI, MOV, FLV, MPEG-TS, 3GP, WMV, OGV
                    <br />• <strong>{t('Audio:')}</strong> MP3, WAV, M4A, FLAC, OGG, Opus, AIFF, WMA
                    <br />• <strong>{t('Documents:')}</strong> PDF, DOCX/DOTX, XLSX, PPTX, EPUB, OpenDocument (ODT/ODS/ODP and related
                    formats),
                    {t('and legacy Office files; some are recognized for identification only')}
                    <br />• <strong>{t('Text & Data:')}</strong> JSON, CSV, TSV, Plain Text
                  </p>
                  <div>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose a different file')}
                    </Button>
                  </div>
                </div>
              ) : /* 4. Supported: Target Format Selector */
              !hasAvailableTargets && detected.family === 'document' ? (
                <div className={styles.unsupportedCard}>
                  <div className={styles.unsupportedTitle}>{t('Conversion unavailable')}</div>
                  <p className={styles.unsupportedText}>
                    {t('This document format is recognized, but it has no available conversion targets.')}
                    {OFFICE_FORMATS[detected.id]?.limitation && ` ${t(OFFICE_FORMATS[detected.id].limitation ?? '')}`}
                  </p>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Choose a different file')}
                  </Button>
                </div>
              ) : (
                <div>
                  <Field label={t('Output format')}>
                    <select
                      className="select"
                      value={selectedTarget?.id ?? ''}
                      onChange={(e) => {
                        const target = Object.values(targetFamilies)
                          .flat()
                          .find((candidate) => candidate.id === e.target.value);
                        setSelectedTarget(target || null);
                      }}
                    >
                      <option value="" disabled>
                        {t('Select a format')}
                      </option>
                      {(['image', 'video', 'audio', 'document', 'text'] as FormatFamily[]).map((family) => {
                        const targets = targetFamilies[family];
                        if (!targets || targets.length === 0) return null;

                        return (
                          <optgroup key={family} label={familyLabels[family]}>
                            {targets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.label}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </Field>

                  {/* 5. Per-Target Options */}
                  {selectedTarget && (
                    <div className={styles.optionsCard}>
                      <div className={styles.optionsTitle}>{t('Conversion options for {format}', { format: selectedTarget.label })}</div>

                      {/* Lossy image quality */}
                      {['jpg', 'webp', 'avif', 'jxl'].includes(selectedTarget.id) && (
                        <Field
                          label={t('Quality ({percent}%)', { percent: quality })}
                          hint={
                            selectedTarget.id === 'jxl'
                              ? t('Controls JPEG XL compression quality (100 is lossless).')
                              : t('Lower values produce smaller files.')
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
                          {t('Encodes static SDR images. Animation and HDR gain maps are not preserved.')}
                        </p>
                      )}

                      {/* Flatten background for JPG / BMP */}
                      {['jpg', 'bmp'].includes(selectedTarget.id) && (
                        <Field label={t('Background colour')} hint={t('Used to flatten any transparent areas.')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input
                              type="color"
                              value={bgColor}
                              onChange={(e) => setBgColor(e.target.value)}
                              style={{ width: '40px', height: '36px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <Button variant={bgColor === '#ffffff' ? 'primary' : 'secondary'} onClick={() => setBgColor('#ffffff')}>
                                {t('White')}
                              </Button>
                              <Button variant={bgColor === '#000000' ? 'primary' : 'secondary'} onClick={() => setBgColor('#000000')}>
                                {t('Black')}
                              </Button>
                            </div>
                          </div>
                        </Field>
                      )}

                      {/* SVG scale option */}
                      {detected.id === 'svg' && (
                        <Field label={t('Raster scale')} hint={t('Scale vector graphics for high resolution.')}>
                          <Select
                            id={svgScaleId}
                            value={svgScale}
                            onChange={(e) => setSvgScale(e.target.value as '1x' | '2x' | '4x')}
                            options={[
                              { value: '1x', label: t('1× (Original size)') },
                              { value: '2x', label: t('2× (Crisp retina)') },
                              { value: '4x', label: t('4× (Ultra high-res)') },
                            ]}
                          />
                        </Field>
                      )}

                      {/* PDF to Image DPI */}
                      {detected.id === 'pdf' && ['png', 'jpg'].includes(selectedTarget.id) && (
                        <Field label={t('Rendering DPI')} hint={t('Higher DPI results in sharper text and larger images.')}>
                          <Select
                            id={dpiId}
                            value={String(dpi)}
                            onChange={(e) => setDpi(Number(e.target.value))}
                            options={[
                              { value: '72', label: t('72 DPI (Standard screen)') },
                              { value: '150', label: t('150 DPI (Balanced / Default)') },
                              { value: '300', label: t('300 DPI (High-res print quality)') },
                            ]}
                          />
                        </Field>
                      )}

                      {/* Audio bitrate */}
                      {['mp3', 'm4a', 'ogg', 'opus'].includes(selectedTarget.id) && (
                        <Field label={t('Audio bitrate')} hint={t('Higher bitrate preserves finer audio quality.')}>
                          <Select
                            id={bitrateId}
                            value={bitrate}
                            onChange={(e) => setBitrate(e.target.value)}
                            options={[
                              { value: '96k', label: t('96 kbps (Voice / compact)') },
                              { value: '128k', label: t('128 kbps (Standard)') },
                              { value: '192k', label: t('192 kbps (High quality)') },
                              { value: '256k', label: t('256 kbps (Very high quality)') },
                            ]}
                          />
                        </Field>
                      )}

                      {/* Convert Action Button */}
                      <div className="action-buttons" style={{ marginTop: '2rem' }}>
                        <Button variant="secondary" onClick={handleReset}>
                          {t('Choose a different file')}
                        </Button>
                        <Button variant="primary" onClick={handleConvert}>
                          {t('Convert to {format}', { format: selectedTarget.label })}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Button variant="secondary" onClick={handleReset}>
              {t('Choose a different file')}
            </Button>
          )}
        </div>
      )}
    </ToolPage>
  );
}
