import { useState, useEffect, useRef, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import { cleanSignaturePixels, cropImageData, type CleanerOptions } from '../_utility/cleaner';

type PresetType = 'signature' | 'stamp';
type OutputMode = 'transparent' | 'white';

export default function SignatureCleanerTool() {
  const meta = getToolMeta('img-signature-cleaner');
  const title =
    meta.title && meta.title !== 'img-signature-cleaner' ? meta.title : 'Signature & Stamp Cleaner';
  const description =
    meta.description ||
    'Remove paper backgrounds from signatures, stamps and seals while preserving thin ink strokes and colors.';

  const [file, setFile] = useState<File | null>(null);
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [sourceData, setSourceData] = useState<ImageData | null>(null);

  // Settings
  const [preset, setPreset] = useState<PresetType>('signature');
  const [threshold, setThreshold] = useState<number>(210);
  const [detail, setDetail] = useState<number>(20);
  const [contrast, setContrast] = useState<number>(35);
  const [outputMode, setOutputMode] = useState<OutputMode>('transparent');
  const [cropToInk, setCropToInk] = useState<boolean>(true);

  // Results
  const [isEmpty, setIsEmpty] = useState<boolean>(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Switch presets
  const handlePresetChange = (newPreset: PresetType) => {
    setPreset(newPreset);
    if (newPreset === 'signature') {
      setThreshold(210);
      setDetail(20);
      setContrast(35);
    } else {
      setThreshold(200);
      setDetail(25);
      setContrast(25);
    }
  };

  // Handle uploaded file
  const handleFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setError(null);
    setIsEmpty(false);

    try {
      const img = await decodeImage(selected);
      setSourceImg(img);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setSourceData(imgData);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to load image');
    }
  }, []);

  // Process image whenever settings or source data change
  useEffect(() => {
    if (!sourceData) return;

    try {
      const options: CleanerOptions = {
        preset,
        threshold,
        detail,
        contrast,
        outputMode,
        cropToInk,
      };

      const cleanResult = cleanSignaturePixels(
        sourceData.data,
        sourceData.width,
        sourceData.height,
        options
      );

      setIsEmpty(cleanResult.isEmpty);

      let finalWidth = cleanResult.width;
      let finalHeight = cleanResult.height;
      let finalData = cleanResult.outputData;

      if (cropToInk && cleanResult.bounds && !cleanResult.isEmpty) {
        const cropped = cropImageData(
          cleanResult.outputData,
          sourceData.width,
          sourceData.height,
          cleanResult.bounds,
          10,
          outputMode === 'white'
        );
        finalWidth = cropped.cropWidth;
        finalHeight = cropped.cropHeight;
        finalData = cropped.croppedData;
      }

      // Ensure canvas is never 0x0
      const safeWidth = Math.max(1, finalWidth);
      const safeHeight = Math.max(1, finalHeight);

      const canvas = previewCanvasRef.current || document.createElement('canvas');
      canvas.width = safeWidth;
      canvas.height = safeHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const outputImageData = ctx.createImageData(safeWidth, safeHeight);
      outputImageData.data.set(finalData);
      ctx.putImageData(outputImageData, 0, 0);

      canvas.toBlob((blob) => {
        if (blob) setResultBlob(blob);
      }, 'image/png');
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Error cleaning signature');
    }
  }, [sourceData, preset, threshold, detail, contrast, outputMode, cropToInk]);

  const handleDownload = () => {
    if (!resultBlob || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    downloadBlob(resultBlob, `${baseName}-cleaned.png`);
  };

  const handleReset = () => {
    setFile(null);
    setSourceImg(null);
    setSourceData(null);
    setResultBlob(null);
    setIsEmpty(false);
    setError(null);
  };

  return (
    <ToolPage title={title} description={description} currentId="img-signature-cleaner">
      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {!file ? (
          <FileDrop
            accept={IMAGE_ACCEPT}
            label="Upload signature, stamp or document image"
            hint="Removes paper background, shadows and textures. 100% private in-browser processing."
            onFiles={handleFiles}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Controls */}
            <div
              style={{
                background: 'var(--surface)',
                padding: '1.25rem',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Field label="Ink Preset">
                  <Select
                    value={preset}
                    onChange={(e) => handlePresetChange(e.target.value as PresetType)}
                    options={[
                      { value: 'signature', label: 'Signature (Dark Pen / Blue / Pencil)' },
                      { value: 'stamp', label: 'Stamp & Seal (Red / Colored Ink)' },
                    ]}
                  />
                </Field>

                <Field label="Output Background">
                  <Select
                    value={outputMode}
                    onChange={(e) => setOutputMode(e.target.value as OutputMode)}
                    options={[
                      { value: 'transparent', label: 'Transparent Background (PNG)' },
                      { value: 'white', label: 'Clean White Background' },
                    ]}
                  />
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <Field label={`Paper Threshold: ${threshold}`} hint="Higher values remove more paper and gray shadows.">
                  <Slider value={threshold} min={100} max={250} step={1} onChange={setThreshold} />
                </Field>

                <Field label={`Stroke Detail / Smoothness: ${detail}`} hint="Feathers edges to avoid jagged pixelation on thin strokes.">
                  <Slider value={detail} min={5} max={60} step={1} onChange={setDetail} />
                </Field>

                <Field label={`Contrast / Ink Boost: ${contrast}%`} hint="Darkens and strengthens faint pen strokes.">
                  <Slider value={contrast} min={0} max={100} step={5} unit="%" onChange={setContrast} />
                </Field>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={cropToInk}
                    onChange={(e) => setCropToInk(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span>
                    <strong>Auto-crop to ink bounds:</strong> Trims empty paper borders around the signature or stamp.
                  </span>
                </label>
              </div>
            </div>

            {error && (
              <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            {isEmpty && (
              <div
                style={{
                  color: '#eab308',
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.25)',
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  fontSize: '0.88rem',
                  lineHeight: '1.4',
                }}
              >
                ⚠️ <strong>No ink strokes detected with current settings.</strong> The paper was completely erased. Try lowering the <em>Paper Threshold</em> slider or adjusting <em>Stroke Detail</em> to bring back faint pen ink.
              </div>
            )}

            {/* Previews: Original and Result */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
              {/* Original Preview */}
              <div
                style={{
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Original Image</span>
                  {sourceImg && (
                    <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                      {sourceImg.naturalWidth}×{sourceImg.naturalHeight} px
                    </span>
                  )}
                </div>
                <div
                  style={{
                    height: '240px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  {sourceImg && (
                    <img
                      src={sourceImg.src}
                      alt="Original"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  )}
                </div>
              </div>

              {/* Cleaned Result Preview */}
              <div
                style={{
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Cleaned Result</span>
                  {resultBlob && (
                    <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                      {formatBytes(resultBlob.size)}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    height: '240px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                      outputMode === 'transparent'
                        ? 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 12px 12px'
                        : '#ffffff',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <canvas
                    ref={previewCanvasRef}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <Button variant="secondary" onClick={handleReset}>
                Start over
              </Button>
              <Button variant="primary" onClick={handleDownload} disabled={!resultBlob || isEmpty}>
                ⬇ Download Cleaned PNG
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
