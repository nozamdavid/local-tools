import { useState, useCallback } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Button } from '../../../components/Controls';
import { ProgressBar } from '../../../components/ProgressBar';
import { getToolMeta } from '../../registry';
import { decodeImage, imageToCanvas, encodeIco, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { zipFiles } from '../../../lib/zip';
import { formatBytes } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { parseIcoDirectory, frameToPngBlob } from '../_utility/ico';

type Mode = 'ico-to-png' | 'png-to-ico';

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

const MULTI_RES_SIZES = [16, 32, 48, 64, 128, 256];

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
  const title = meta.title && meta.title !== 'img-icon-converter' ? meta.title : 'Icon Converter';
  const description =
    meta.description ||
    'Extract all frames from ICO files to PNG, or build multi-resolution Windows ICO icons (16 to 256 px).';

  const [mode, setMode] = useState<Mode>('ico-to-png');
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
      setProcessing(true);
      setProgress(0);

      try {
        if (mode === 'ico-to-png') {
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
          // PNG to Multi-resolution ICO
          const icoItems: GeneratedIcoItem[] = [];

          for (let fIdx = 0; fIdx < files.length; fIdx++) {
            const file = files[fIdx];
            const img = await decodeImage(file);

            // Render 6 standard Windows icon resolutions
            const canvases = MULTI_RES_SIZES.map((size) => imageToCanvas(img, size, size));
            const icoBlob = await encodeIco(canvases);
            const baseName = file.name.replace(/\.[^.]+$/, '');

            icoItems.push({
              name: `${baseName}.ico`,
              blob: icoBlob,
              sizes: '16, 32, 48, 64, 128, 256',
            });
            setProgress(((fIdx + 1) / files.length) * 100);
          }

          setGeneratedIcos(icoItems);
        }
      } catch (err: any) {
        setError(err instanceof Error ? err.message : 'Error processing icon conversion');
      } finally {
        setProcessing(false);
      }
    },
    [mode]
  );

  const handleDownloadAllZip = async () => {
    try {
      if (mode === 'ico-to-png' && extractedFrames.length > 0) {
        const zipBlob = await zipFiles(extractedFrames.map((f) => ({ name: f.name, blob: f.blob })));
        downloadBlob(zipBlob, 'extracted-icon-frames.zip');
      } else if (mode === 'png-to-ico' && generatedIcos.length > 0) {
        const zipBlob = await zipFiles(generatedIcos.map((ico) => ({ name: ico.name, blob: ico.blob })));
        downloadBlob(zipBlob, 'multi-resolution-icons.zip');
      }
    } catch (err: any) {
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
                : 'Converts any raster image into a complete multi-resolution Windows .ICO with 6 standard resolutions.'
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
                { value: 'png-to-ico', label: 'Create multi-resolution: PNG → ICO (Generates 16, 32, 48, 64, 128, 256 px)' },
              ]}
            />
          </Field>
        </div>

        {error && (
          <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.85rem 1rem', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        {/* Upload Zone */}
        {!hasResults && !processing && (
          <FileDrop
            accept={mode === 'ico-to-png' ? 'image/x-icon,image/vnd.microsoft.icon,.ico' : IMAGE_ACCEPT}
            multiple={true}
            label={
              mode === 'ico-to-png'
                ? 'Choose one or more .ICO files or drag them here'
                : 'Choose one or more image files (PNG, JPG, WebP) to build .ICO'
            }
            hint={
              mode === 'ico-to-png'
                ? 'Decodes both PNG streams and standard DIB frames with AND transparency masks.'
                : 'Generates Windows-compatible multi-resolution icon with 16, 32, 48, 64, 128, and 256 px frames.'
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
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  Every embedded frame extracted with transparency preserved
                </span>
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

        {/* Results for PNG -> ICO */}
        {mode === 'png-to-ico' && generatedIcos.length > 0 && (
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
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Generated Multi-Resolution Icons</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  Embedded resolutions: 16×16, 32×32, 48×48, 64×64, 128×128, 256×256
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
                      6 frames (16 to 256 px) · {formatBytes(ico.blob.size)}
                    </span>
                  </div>
                  <Button variant="primary" onClick={() => downloadBlob(ico.blob, ico.name)}>
                    Download ICO
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
