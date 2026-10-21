import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { type PaletteColor, extractPalette, generatePaletteStripBlob } from '../_color/palette';
import styles from './Tool.module.css';

export default function ColorPaletteTool() {
  const meta = getToolMeta('img-color-palette');
  const [file, setFile] = useState<File | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [colorCount, setColorCount] = useState<number>(8);
  const [palette, setPalette] = useState<PaletteColor[]>([]);
  const [exportMode, setExportMode] = useState<'css' | 'json'>('css');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExtraction = (img: HTMLImageElement, count: number) => {
    const canvas = document.createElement('canvas');
    // downscale sample if large to speed up processing
    const maxSide = 300;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxSide || h > maxSide) {
      if (w > h) {
        h = Math.round((h * maxSide) / w);
        w = maxSide;
      } else {
        w = Math.round((w * maxSide) / h);
        h = maxSide;
      }
    }
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const colors = extractPalette(ctx, canvas.width, canvas.height, count);
    setPalette(colors);
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    try {
      const selected = files[0];
      const img = await decodeImage(selected);
      setFile(selected);
      setImgElement(img);
      runExtraction(img, colorCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode image');
    }
  };

  const handleCountChange = (newCount: number) => {
    setColorCount(newCount);
    if (imgElement) {
      runExtraction(imgElement, newCount);
    }
  };

  const handleReset = () => {
    setFile(null);
    setImgElement(null);
    setPalette([]);
    setError(null);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const getCssVariables = () => {
    const lines = palette.map((c, idx) => `  --color-${idx + 1}: ${c.hex.toLowerCase()}; /* ${c.share}% */`);
    return `:root {\n${lines.join('\n')}\n}`;
  };

  const getJsonExport = () => {
    const data = palette.map((c) => ({
      hex: c.hex.toLowerCase(),
      rgb: c.rgb,
      hsl: c.hsl,
      share: c.share,
    }));
    return JSON.stringify(data, null, 2);
  };

  const downloadJson = () => {
    const blob = new Blob([getJsonExport()], { type: 'application/json' });
    downloadBlob(blob, 'color-palette.json');
  };

  const downloadPngStrip = async () => {
    try {
      const blob = await generatePaletteStripBlob(palette);
      downloadBlob(blob, 'palette-strip.png');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PNG palette strip');
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-color-palette">
      <div className={styles.container}>
        {error && <div className="error-banner">{error}</div>}

        {!file ? (
          <FileDrop
            accept="image/*"
            label="Drop an image here to extract colours"
            hint="Supports JPG, PNG, WEBP, SVG, HEIC and more."
            onFiles={handleFiles}
          />
        ) : (
          <>
            <div className={styles.controlsRow}>
              <div className={styles.sliderWrapper}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Colours:</span>
                <Slider min={5} max={12} step={1} value={colorCount} onChange={handleCountChange} />
              </div>

              <Button variant="secondary" onClick={handleReset}>
                Choose different image
              </Button>
            </div>

            {palette.length > 0 && (
              <>
                <div className={styles.paletteBar}>
                  {palette.map((c, idx) => (
                    <div
                      key={`bar-${c.hex}-${idx}`}
                      className={styles.paletteBarSegment}
                      style={{
                        backgroundColor: c.hex,
                        flex: c.share,
                      }}
                      title={`${c.hex.toUpperCase()} (${c.share}%)`}
                      onClick={() => copyToClipboard(c.hex.toUpperCase(), `bar-${idx}`)}
                    />
                  ))}
                </div>

                <div className={styles.swatchesGrid}>
                  {palette.map((c, idx) => (
                    <div key={`swatch-${c.hex}-${idx}`} className={styles.swatchCard}>
                      <div className={styles.swatchColor} style={{ backgroundColor: c.hex }}>
                        <span className={styles.shareBadge}>{c.share}%</span>
                      </div>
                      <div className={styles.swatchDetails}>
                        <div className={styles.swatchRow}>
                          <span className={styles.codeText}>{c.hex.toUpperCase()}</span>
                          <Button
                            variant="secondary"
                            onClick={() => copyToClipboard(c.hex.toUpperCase(), `hex-${idx}`)}
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            {copiedKey === `hex-${idx}` ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                        <div className={styles.swatchRow}>
                          <span className={styles.codeText} title={c.rgb}>
                            {c.rgb}
                          </span>
                          <Button
                            variant="secondary"
                            onClick={() => copyToClipboard(c.rgb, `rgb-${idx}`)}
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            {copiedKey === `rgb-${idx}` ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                        <div className={styles.swatchRow}>
                          <span className={styles.codeText} title={c.hsl}>
                            {c.hsl}
                          </span>
                          <Button
                            variant="secondary"
                            onClick={() => copyToClipboard(c.hsl, `hsl-${idx}`)}
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            {copiedKey === `hsl-${idx}` ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.exportSection}>
                  <div className={styles.exportHeader}>
                    <span className={styles.exportTitle}>Export Palette</span>
                    <div className={styles.exportTabs}>
                      <Button
                        variant={exportMode === 'css' ? 'primary' : 'secondary'}
                        onClick={() => setExportMode('css')}
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
                      >
                        CSS Variables
                      </Button>
                      <Button
                        variant={exportMode === 'json' ? 'primary' : 'secondary'}
                        onClick={() => setExportMode('json')}
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
                      >
                        JSON
                      </Button>
                    </div>
                  </div>

                  <textarea readOnly className={styles.exportTextarea} value={exportMode === 'css' ? getCssVariables() : getJsonExport()} />

                  <div className={styles.exportActions}>
                    <Button
                      variant="secondary"
                      onClick={() => copyToClipboard(exportMode === 'css' ? getCssVariables() : getJsonExport(), 'export-copy')}
                    >
                      {copiedKey === 'export-copy' ? 'Copied to clipboard!' : 'Copy to clipboard'}
                    </Button>
                    {exportMode === 'json' && (
                      <Button variant="secondary" onClick={downloadJson}>
                        Download JSON
                      </Button>
                    )}
                    <Button variant="primary" onClick={downloadPngStrip}>
                      Download PNG strip
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ToolPage>
  );
}
