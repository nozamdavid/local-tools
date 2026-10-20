import { useState, useRef, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field, Select } from '../../../components/Controls';
import { ProgressBar } from '../../../components/ProgressBar';
import { getToolMeta } from '../../registry';
import { decodeImage, imageToCanvas, canvasToBlob, encodeIco } from '../../../lib/image';
import { zipFiles } from '../../../lib/zip';
import { downloadBlob } from '../../../lib/download';
import styles from './Tool.module.css';

interface GeneratedFile {
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

const SIZES = [
  { size: 16, filename: 'favicon-16x16.png', label: '16×16 (Standard)' },
  { size: 32, filename: 'favicon-32x32.png', label: '32×32 (Standard)' },
  { size: 48, filename: 'favicon-48x48.png', label: '48×48 (Windows)' },
  { size: 64, filename: 'favicon-64x64.png', label: '64×64 (HiDPI)' },
  { size: 128, filename: 'favicon-128x128.png', label: '128×128 (Chrome web store)' },
  { size: 180, filename: 'apple-touch-icon.png', label: '180×180 (Apple Touch)' },
  { size: 192, filename: 'android-chrome-192x192.png', label: '192×192 (Android Chrome)' },
  { size: 512, filename: 'android-chrome-512x512.png', label: '512×512 (PWA Splash)' },
];

const HTML_SNIPPET = `<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`;

export default function FaviconGeneratorTool() {
  const meta = getToolMeta('img-favicon-generator');

  const [mode, setMode] = useState<'upload' | 'text'>('upload');
  const [file, setFile] = useState<File | null>(null);

  // Text/Emoji generator state
  const [textChar, setTextChar] = useState<string>('★');
  const [fontFamily, setFontFamily] = useState<string>('sans-serif');
  const [textColor, setTextColor] = useState<string>('#ffffff');
  const [bgColor, setBgColor] = useState<string>('#3b82f6');
  const [shape, setShape] = useState<'square' | 'rounded' | 'circle'>('rounded');

  // Generation state
  const [generating, setGenerating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [icoBlob, setIcoBlob] = useState<Blob | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Render text designer preview canvas
  useEffect(() => {
    if (mode !== 'text' || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 128;
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    // Draw background shape
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    let radius = 0;
    if (shape === 'rounded') radius = size * 0.22;
    if (shape === 'circle') radius = size * 0.5;

    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();

    // Draw text / emoji
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(size * 0.62)}px ${fontFamily}`;
    ctx.fillText(textChar || 'A', size / 2, size / 2);
  }, [mode, textChar, fontFamily, textColor, bgColor, shape]);

  const generateSourceCanvas = async (): Promise<HTMLCanvasElement> => {
    if (mode === 'upload' && file) {
      const img = await decodeImage(file);
      return imageToCanvas(img);
    }

    // Text mode: render high-res 512x512 canvas
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    let radius = 0;
    if (shape === 'rounded') radius = size * 0.22;
    if (shape === 'circle') radius = size * 0.5;

    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(size * 0.62)}px ${fontFamily}`;
    ctx.fillText(textChar || 'A', size / 2, size / 2);

    return canvas;
  };

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    setProgress(0);

    try {
      const sourceCanvas = await generateSourceCanvas();
      const files: GeneratedFile[] = [];
      const icoCanvases: HTMLCanvasElement[] = [];

      for (let i = 0; i < SIZES.length; i++) {
        const item = SIZES[i];
        const scaledCanvas = imageToCanvas(sourceCanvas, item.size, item.size);

        if (item.size === 16 || item.size === 32 || item.size === 48) {
          icoCanvases.push(scaledCanvas);
        }

        const pngBlob = await canvasToBlob(scaledCanvas, 'image/png');
        const previewUrl = URL.createObjectURL(pngBlob);
        files.push({
          name: item.filename,
          blob: pngBlob,
          previewUrl,
          width: item.size,
          height: item.size,
        });

        setProgress((i + 1) / (SIZES.length + 2));
      }

      // Generate multi-resolution favicon.ico (16, 32, 48)
      const ico = await encodeIco(icoCanvases);
      setIcoBlob(ico);
      setProgress((SIZES.length + 1) / (SIZES.length + 2));

      // Generate site.webmanifest
      const manifest = {
        name: 'App',
        short_name: 'App',
        icons: [
          {
            src: '/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
        theme_color: bgColor,
        background_color: bgColor,
        display: 'standalone',
      };
      const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/manifest+json',
      });

      // Package everything in a ZIP file
      const zipItems = [
        { name: 'favicon.ico', blob: ico },
        ...files.map((f) => ({ name: f.name, blob: f.blob })),
        { name: 'site.webmanifest', blob: manifestBlob },
      ];

      const zip = await zipFiles(zipItems);
      setZipBlob(zip);
      setGeneratedFiles(files);
      setProgress(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate favicons');
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    generatedFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setGeneratedFiles([]);
    setIcoBlob(null);
    setZipBlob(null);
    setFile(null);
    setError(null);
    setProgress(0);
  };

  const handleUploadFiles = (inFiles: File[]) => {
    if (inFiles.length === 0) return;
    setFile(inFiles[0]);
  };

  const copyHtml = () => {
    navigator.clipboard.writeText(HTML_SNIPPET);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 1500);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-favicon-generator">
      <div className={styles.container}>
        {error && <div className="error-banner">{error}</div>}

        {generatedFiles.length > 0 && zipBlob ? (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                Favicon package ready ({generatedFiles.length + 2} files)
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Create new favicon
                </Button>
                <Button
                  variant="primary"
                  onClick={() => downloadBlob(zipBlob, 'favicon_package.zip')}
                >
                  Download all (.zip)
                </Button>
              </div>
            </div>

            <div className={styles.previewGrid}>
              <div className={styles.iconPreviewCard}>
                {icoBlob && (
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.75rem',
                    }}
                  >
                    ⭐
                  </div>
                )}
                <div className={styles.iconLabel}>favicon.ico</div>
                <div className={styles.iconSize}>16, 32, 48 px</div>
                <Button
                  variant="secondary"
                  onClick={() => icoBlob && downloadBlob(icoBlob, 'favicon.ico')}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Download
                </Button>
              </div>

              {generatedFiles.map((f) => (
                <div key={f.name} className={styles.iconPreviewCard}>
                  <img src={f.previewUrl} alt={f.name} className={styles.iconPreviewImg} />
                  <div className={styles.iconLabel}>{f.name}</div>
                  <div className={styles.iconSize}>
                    {f.width}×{f.height} px
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => downloadBlob(f.blob, f.name)}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    Download
                  </Button>
                </div>
              ))}
            </div>

            <div className={styles.codeBox} style={{ marginTop: '1.5rem' }}>
              <div className={styles.codeHeader}>
                <span className={styles.codeTitle}>HTML &lt;head&gt; code</span>
                <Button
                  variant="secondary"
                  onClick={copyHtml}
                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                >
                  {copiedSnippet ? 'Copied HTML!' : 'Copy HTML'}
                </Button>
              </div>
              <pre className={styles.codeSnippet}>{HTML_SNIPPET}</pre>
            </div>
          </div>
        ) : (
          <div>
            <div className={styles.modeTabs}>
              <Button
                variant={mode === 'upload' ? 'primary' : 'secondary'}
                onClick={() => setMode('upload')}
              >
                Upload image
              </Button>
              <Button
                variant={mode === 'text' ? 'primary' : 'secondary'}
                onClick={() => setMode('text')}
              >
                Text / Emoji icon
              </Button>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
              {mode === 'upload' ? (
                <div>
                  {!file ? (
                    <FileDrop
                      accept="image/*"
                      label="Drop an icon or logo here"
                      hint="Recommended: 512×512 PNG, SVG, or high-res JPG."
                      onFiles={handleUploadFiles}
                    />
                  ) : (
                    <div>
                      <div className="meta-chips">
                        <span className="meta-chip">
                          Selected file: <strong>{file.name}</strong>
                        </span>
                      </div>
                      <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                        <Button variant="secondary" onClick={() => setFile(null)}>
                          Choose different file
                        </Button>
                        <Button variant="primary" onClick={handleGenerate} disabled={generating}>
                          Generate favicon package
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.textDesignerCard}>
                  <div className={styles.previewCol}>
                    <canvas ref={previewCanvasRef} className={styles.designerPreviewCanvas} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Preview (128×128)
                    </span>
                  </div>

                  <div className={styles.designerControls}>
                    <Field label="Letter or Emoji">
                      <input
                        type="text"
                        maxLength={2}
                        value={textChar}
                        onChange={(e) => setTextChar(e.target.value)}
                        className="select"
                        style={{ fontFamily: fontFamily }}
                      />
                    </Field>

                    <Field label="Font Family">
                      <Select
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        options={[
                          { value: 'sans-serif', label: 'Sans-Serif' },
                          { value: 'serif', label: 'Serif' },
                          { value: 'monospace', label: 'Monospace' },
                        ]}
                      />
                    </Field>

                    <Field label="Text Colour">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="color"
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          style={{ width: '40px', height: '36px', border: 'none', cursor: 'pointer' }}
                        />
                        <input
                          type="text"
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="select"
                          style={{ flex: 1 }}
                        />
                      </div>
                    </Field>

                    <Field label="Background Colour">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="color"
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          style={{ width: '40px', height: '36px', border: 'none', cursor: 'pointer' }}
                        />
                        <input
                          type="text"
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          className="select"
                          style={{ flex: 1 }}
                        />
                      </div>
                    </Field>

                    <Field label="Icon Shape">
                      <Select
                        value={shape}
                        onChange={(e) => setShape(e.target.value as 'square' | 'rounded' | 'circle')}
                        options={[
                          { value: 'rounded', label: 'Rounded corners' },
                          { value: 'circle', label: 'Circle' },
                          { value: 'square', label: 'Square' },
                        ]}
                      />
                    </Field>

                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button
                        variant="primary"
                        onClick={handleGenerate}
                        disabled={generating}
                        style={{ width: '100%', height: '42px' }}
                      >
                        Generate favicon package
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {generating && (
                <div style={{ marginTop: '1.5rem' }}>
                  <ProgressBar value={progress} label="Generating favicon sizes and package…" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
