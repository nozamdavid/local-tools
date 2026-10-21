import { useState, useEffect, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import { generateEmbeddedSvg, generatePixelSvg } from '../_utility/svg';

type SvgMode = 'embed' | 'pixel';

export default function ImageToSvgTool() {
  const meta = getToolMeta('img-image-to-svg');
  const title = meta.title && meta.title !== 'img-image-to-svg' ? meta.title : 'Image to SVG Converter';
  const description = meta.description || 'Convert raster images (PNG, JPG, WebP) into scalable SVG vector graphics or embed them safely.';

  const [file, setFile] = useState<File | null>(null);
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);

  // Settings
  const [mode, setMode] = useState<SvgMode>('embed');
  const [pixelResolution, setPixelResolution] = useState<number>(64); // max bounded to 128

  // Output
  const [svgString, setSvgString] = useState<string>('');
  const [svgBlob, setSvgBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Handle file drop
  const handleFiles = useCallback((files: File[]) => {
    if (!files || files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setError(null);
    setCopied(false);

    // Read data URI
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const uri = reader.result as string;
        setDataUri(uri);
        const img = await decodeImage(selected);
        setSourceImg(img);
      } catch (err: any) {
        setError(err instanceof Error ? err.message : 'Failed to decode image');
      }
    };
    reader.onerror = () => setError('Failed to read image file');
    reader.readAsDataURL(selected);
  }, []);

  // Generate SVG when settings or image changes
  useEffect(() => {
    if (!sourceImg || !dataUri) return;

    try {
      const origW = sourceImg.naturalWidth || sourceImg.width;
      const origH = sourceImg.naturalHeight || sourceImg.height;

      let resultSvg = '';

      if (mode === 'embed') {
        resultSvg = generateEmbeddedSvg(dataUri, origW, origH);
      } else {
        // Pixel shapes mode: bounded to max 128x128 with explicit resolution
        const targetMax = Math.min(128, Math.max(8, pixelResolution));
        const maxSide = Math.max(origW, origH);
        const scale = Math.min(1, targetMax / maxSide);
        const targetW = Math.max(1, Math.round(origW * scale));
        const targetH = Math.max(1, Math.round(origH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceImg, 0, 0, targetW, targetH);

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        resultSvg = generatePixelSvg(imgData.data, targetW, targetH, { groupConsecutive: true });
      }

      setSvgString(resultSvg);
      const blob = new Blob([resultSvg], { type: 'image/svg+xml' });
      setSvgBlob(blob);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Error generating SVG');
    }
  }, [sourceImg, dataUri, mode, pixelResolution]);

  const handleCopy = async () => {
    if (!svgString) return;
    try {
      await navigator.clipboard.writeText(svgString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const handleDownload = () => {
    if (!svgBlob || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    downloadBlob(svgBlob, `${baseName}.svg`);
  };

  const handleReset = () => {
    setFile(null);
    setDataUri(null);
    setSourceImg(null);
    setSvgString('');
    setSvgBlob(null);
    setError(null);
    setCopied(false);
  };

  return (
    <ToolPage title={title} description={description} currentId="img-image-to-svg">
      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {!file ? (
          <FileDrop
            accept={IMAGE_ACCEPT}
            label="Choose an image or drag it here"
            hint="Supports PNG, JPG, WebP and more."
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
              <Field
                label="Conversion Mode"
                hint={
                  mode === 'embed'
                    ? 'Wraps original raster image inside an SVG container. Retains full photo detail.'
                    : 'Maps pixels to geometric vector rectangles. 100% scalable vector art with alpha transparency.'
                }
              >
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as SvgMode)}
                  options={[
                    { value: 'embed', label: 'Raster Embed (Preserve original image data)' },
                    { value: 'pixel', label: 'Pixel Vector Shapes (Crisp geometric <rect> paths, max 128px)' },
                  ]}
                />
              </Field>

              {/* Clear explanation banner */}
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  background: 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  fontSize: '0.88rem',
                  lineHeight: '1.45',
                }}
              >
                {mode === 'embed' ? (
                  <div>
                    💡 <strong>Raster Embed Mode:</strong> Packages your exact original image bytes inside an SVG container with proper
                    viewBox and width/height dimensions. Best for web workflows, documents, and lightweight vector wrappers without altering
                    pixels.
                  </div>
                ) : (
                  <div>
                    ✨ <strong>Pixel Vector Shapes Mode:</strong> Converts pixel rows into native geometric SVG <code>&lt;rect&gt;</code>{' '}
                    vector paths, grouping identical neighboring pixels and maintaining alpha transparency. Scalable to any size without
                    blur—ideal for pixel art, sprites, logos, and retro graphics (bounded to 128×128 max for high performance).
                  </div>
                )}
              </div>

              {mode === 'pixel' && (
                <Field
                  label={`Vector Grid Resolution: ${pixelResolution}×${pixelResolution} px (Max 128×128)`}
                  hint="Higher resolution captures finer pixel details; lower resolution creates chunky pixel art."
                >
                  <Slider value={pixelResolution} min={16} max={128} step={8} unit="px" onChange={setPixelResolution} />
                </Field>
              )}
            </div>

            {error && (
              <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '8px' }}>{error}</div>
            )}

            {/* Preview Box */}
            <div
              style={{
                background: 'var(--surface)',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>SVG Preview</span>
                {svgBlob && <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Size: {formatBytes(svgBlob.size)}</span>}
              </div>

              <div
                style={{
                  minHeight: '260px',
                  maxHeight: '450px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 16px 16px',
                  borderRadius: '8px',
                  padding: '1rem',
                  overflow: 'auto',
                }}
              >
                {svgString ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: svgString }}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '400px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  />
                ) : (
                  <span>Rendering preview...</span>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Start over
                </Button>
                <Button variant="secondary" onClick={handleCopy} disabled={!svgString}>
                  {copied ? '✓ Copied SVG code!' : '📋 Copy SVG'}
                </Button>
                <Button variant="primary" onClick={handleDownload} disabled={!svgBlob}>
                  ⬇ Download SVG
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
