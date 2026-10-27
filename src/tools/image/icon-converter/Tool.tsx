import { useState, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Button } from '../../../components/Controls';
import { ProgressBar } from '../../../components/ProgressBar';
import { getToolMeta } from '../../registry';
import { decodeImage, encodeIco, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { zipFiles } from '../../../lib/zip';
import { formatBytes } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { peekPendingFiles } from '../../../lib/handoff';
import { classifyFile } from '../../../lib/toolInputs';
import { parseIcoDirectory, frameToPngBlob } from '../_utility/ico';

type Mode = 'ico-to-png' | 'image-to-ico';

interface ExtractedFrameItem {
  id: string;
  name: string;
  width: number;
  height: number;
  bitCount: number;
  format: string;
  blob: Blob;
}

interface GeneratedIcoItem {
  name: string;
  blob: Blob;
  sizes: string;
}

const RECOMMENDED_SIZES = [16, 32, 48];
const ALL_SIZES = [16, 32, 48, 64, 128, 256];
const SINGLE_SIZES = ALL_SIZES;

function imageToIconCanvas(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');

  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

function ExtractedItemRow({ item }: { item: ExtractedFrameItem }) {
  const url = useObjectUrl(item.blob);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        background: 'var(--surface)',
        borderRadius: '8px',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 8px 8px',
            borderRadius: '6px',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {url && (
            <img
              src={url}
              alt={item.name}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                imageRendering: item.width <= 32 ? 'pixelated' : 'auto',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </span>
          <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
            {item.width}×{item.height} px · {item.bitCount}-bit · {item.format} · {formatBytes(item.blob.size)}
          </span>
        </div>
      </div>

      <Button
        variant="secondary"
        style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', flexShrink: 0 }}
        onClick={() => downloadBlob(item.blob, item.name)}
      >
        Download
      </Button>
    </div>
  );
}

export default function IconConverterTool() {
  const meta = getToolMeta('img-icon-converter');
  const title = meta.title && meta.title !== 'img-icon-converter' ? meta.title : 'Image to Favicon / ICO';
  const description = meta.description || 'Convert images to favicon.ico at your chosen resolution, or extract frames from ICO files.';

  const [mode, setMode] = useState<Mode>(() => {
    const pending = peekPendingFiles('/image/icon-converter');
    if (pending && pending.length > 0) {
      const c = classifyFile(pending[0]);
      return c.format === 'ico' ? 'ico-to-png' : 'image-to-ico';
    }
    return 'image-to-ico';
  });
  const [resolution, setResolution] = useState('recommended');

  const [processing, setProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // ICO to PNG state
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrameItem[]>([]);

  // PNG to ICO state
  const [generatedIcos, setGeneratedIcos] = useState<GeneratedIcoItem[]>([]);

  // Process files
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files || files.length === 0) return;
      setError(null);

      const classes = files.map(classifyFile);
      const hasIco = classes.some((c) => c.format === 'ico');
      const hasImage = classes.some((c) => c.isStandardImage);

      if (hasIco && hasImage) {
        setError(
          'Mixed input formats: cannot process ICO and image files in the same batch. Please upload either ICO files or supported images.',
        );
        return;
      }

      if (!hasIco && !hasImage) {
        setError('Please upload an ICO file or a supported image format.');
        return;
      }

      const targetMode: Mode = hasIco ? 'ico-to-png' : 'image-to-ico';
      setMode(targetMode);

      setProcessing(true);
      setProgress(0);

      try {
        if (targetMode === 'ico-to-png') {
          const items: ExtractedFrameItem[] = [];
          const nameTracker = new Map<string, number>();

          for (let fIdx = 0; fIdx < files.length; fIdx++) {
            const file = files[fIdx];
            const buffer = await file.arrayBuffer();
            const { frames } = parseIcoDirectory(buffer);
            const base = file.name.replace(/\.[^.]+$/, '');

            for (let i = 0; i < frames.length; i++) {
              const frame = frames[i];
              const pngBlob = await frameToPngBlob(frame);

              const dimKey = `${base}-${frame.width}x${frame.height}`;
              const count = nameTracker.get(dimKey) || 0;
              nameTracker.set(dimKey, count + 1);

              const suffix = count === 0 ? '' : `-${count + 1}`;
              const filename = `${dimKey}${suffix}.png`;

              items.push({
                id: `${file.name}-${i}-${Date.now()}`,
                name: filename,
                width: frame.width,
                height: frame.height,
                bitCount: frame.bitCount,
                format: frame.isPng ? 'PNG stream' : 'DIB bitmap',
                blob: pngBlob,
              });
            }
            setProgress(((fIdx + 1) / files.length) * 100);
          }

          if (items.length === 0) {
            throw new Error('No valid icon frames could be found in the uploaded file(s).');
          }
          setExtractedFrames(items);
        } else {
          // Image to ICO
          const icoItems: GeneratedIcoItem[] = [];
          const nameCounts = new Map<string, number>();
          const usedNames = new Set<string>();
          const sizes = resolution === 'recommended' ? RECOMMENDED_SIZES : resolution === 'all' ? ALL_SIZES : [Number(resolution)];

          for (let fIdx = 0; fIdx < files.length; fIdx++) {
            const file = files[fIdx];
            const img = await decodeImage(file);

            const canvases = sizes.map((size) => imageToIconCanvas(img, size));
            const icoBlob = await encodeIco(canvases);
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
            let outputName = 'favicon.ico';
            if (files.length > 1) {
              let count = nameCounts.get(baseName) || 0;
              do {
                outputName = `${baseName}${count === 0 ? '' : `-${count + 1}`}.ico`;
                count += 1;
              } while (usedNames.has(outputName.toLowerCase()));
              nameCounts.set(baseName, count);
              usedNames.add(outputName.toLowerCase());
            }

            icoItems.push({
              name: outputName,
              blob: icoBlob,
              sizes: sizes.join(', '),
            });
            setProgress(((fIdx + 1) / files.length) * 100);
          }

          setGeneratedIcos(icoItems);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error processing icon conversion');
      } finally {
        setProcessing(false);
      }
    },
    [resolution],
  );

  const handleDownloadAllZip = async () => {
    try {
      if (mode === 'ico-to-png' && extractedFrames.length > 0) {
        const zipBlob = await zipFiles(extractedFrames.map((f) => ({ name: f.name, blob: f.blob })));
        downloadBlob(zipBlob, 'extracted-icon-frames.zip');
      } else if (mode === 'image-to-ico' && generatedIcos.length > 0) {
        const zipBlob = await zipFiles(generatedIcos.map((ico) => ({ name: ico.name, blob: ico.blob })));
        downloadBlob(zipBlob, 'favicons.zip');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate ZIP');
    }
  };

  const handleReset = () => {
    setExtractedFrames([]);
    setGeneratedIcos([]);
    setError(null);
    setProgress(0);
  };

  const hasResults = extractedFrames.length > 0 || generatedIcos.length > 0;

  return (
    <ToolPage title={title} description={description} currentId="img-icon-converter">
      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Mode Selector */}
        <div
          style={{
            background: 'var(--surface)',
            padding: '1.25rem',
            borderRadius: '12px',
          }}
        >
          <Field
            label="Icon Conversion Mode"
            hint={
              mode === 'ico-to-png'
                ? 'Extracts every single embedded resolution and frame inside .ICO files into individual transparent PNGs.'
                : 'Converts any supported image into a Windows .ICO with your selected resolution set.'
            }
          >
            <Select
              value={mode}
              disabled={processing || hasResults}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                handleReset();
              }}
              options={[
                { value: 'ico-to-png', label: 'Extract frames: ICO → PNG (Extracts 16, 32, 48, 64, 128, 256...)' },
                { value: 'image-to-ico', label: 'Create favicon / ICO from an image' },
              ]}
            />
          </Field>
        </div>

        {mode === 'image-to-ico' && !hasResults && (
          <div style={{ background: 'var(--surface)', padding: '1.25rem', borderRadius: '12px' }}>
            <Field
              label="ICO resolution"
              hint="Recommended includes 16×16, 32×32, and 48×48 px. The image stays centered with its aspect ratio preserved."
            >
              <Select
                value={resolution}
                disabled={processing}
                onChange={(e) => setResolution(e.target.value)}
                options={[
                  { value: 'recommended', label: 'Recommended multi-size (16, 32, 48 px)' },
                  ...SINGLE_SIZES.map((size) => ({ value: String(size), label: `Single size (${size}×${size} px)` })),
                  { value: 'all', label: 'All sizes (16, 32, 48, 64, 128, 256 px)' },
                ]}
              />
            </Field>
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.85rem 1rem', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        {/* Upload Zone */}
        {!hasResults && !processing && (
          <FileDrop
            accept={`${IMAGE_ACCEPT},.ico,image/x-icon,image/vnd.microsoft.icon`}
            multiple={true}
            label={
              mode === 'ico-to-png'
                ? 'Choose one or more .ICO files or drag them here'
                : 'Choose one or more supported image files to create favicon.ico'
            }
            hint={
              mode === 'ico-to-png'
                ? 'Decodes both PNG streams and standard DIB frames with AND transparency masks.'
                : `Creates ICO frame${resolution === 'recommended' || resolution === 'all' ? 's' : ''} at ${
                    resolution === 'recommended' ? '16, 32, and 48' : resolution === 'all' ? '16, 32, 48, 64, 128, and 256' : resolution
                  } px, with transparent padding around the image as needed.`
            }
            onFiles={handleFiles}
          />
        )}

        {/* Processing State */}
        {processing && (
          <div
            style={{
              background: 'var(--surface)',
              padding: '2rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <span>Converting icon files...</span>
            <div style={{ width: '100%', maxWidth: '400px' }}>
              <ProgressBar value={progress / 100} />
            </div>
          </div>
        )}

        {/* Results for ICO -> PNG */}
        {mode === 'ico-to-png' && extractedFrames.length > 0 && (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Extracted Frames ({extractedFrames.length})</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>Every embedded frame extracted with transparency preserved</span>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Convert more
                </Button>
                <Button variant="primary" onClick={handleDownloadAllZip}>
                  Download All as ZIP
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {extractedFrames.map((item) => (
                <ExtractedItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Results for image -> ICO */}
        {mode === 'image-to-ico' && generatedIcos.length > 0 && (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Generated Favicons / ICO Files</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  Embedded resolutions:{' '}
                  {generatedIcos[0].sizes
                    .split(', ')
                    .map((size) => `${size}×${size}`)
                    .join(', ')}{' '}
                  px
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Convert more
                </Button>
                {generatedIcos.length > 1 && (
                  <Button variant="primary" onClick={handleDownloadAllZip}>
                    Download All as ZIP
                  </Button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {generatedIcos.map((ico, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontWeight: 600 }}>{ico.name}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                      {ico.sizes.split(', ').length} frame{ico.sizes.split(', ').length === 1 ? '' : 's'} ({ico.sizes} px) ·{' '}
                      {formatBytes(ico.blob.size)}
                    </span>
                  </div>
                  <Button variant="primary" onClick={() => downloadBlob(ico.blob, ico.name)}>
                    {generatedIcos.length === 1 ? 'Download favicon.ico' : 'Download ICO'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
