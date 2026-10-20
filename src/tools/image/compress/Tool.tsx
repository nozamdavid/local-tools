import { useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { compressImage, detectAlpha, renderScaledCanvas, type CompressResult } from '../_basic';

type MaxDimensionOption = 'original' | '1920' | '1280' | '1080' | '800' | 'custom';

export default function CompressTool() {
  const meta = getToolMeta('img-compress');
  const [file, setFile] = useState<File | null>(null);
  const [imgMeta, setImgMeta] = useState<{ width: number; height: number; hasAlpha: boolean } | null>(null);
  const [quality, setQuality] = useState<number>(75);
  const [maxDimensionOpt, setMaxDimensionOpt] = useState<MaxDimensionOption>('original');
  const [customMaxDim, setCustomMaxDim] = useState<number>(1920);
  const [format, setFormat] = useState<EncodableMime>('image/jpeg');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<CompressResult | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const formatId = useId();
  const maxDimId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setImgMeta(null);
    setResultInfo(null);
    job.reset();

    try {
      const img = await decodeImage(selected);
      const testCanvas = renderScaledCanvas(img, img.width, img.height, img.width, img.height);
      const hasAlpha = detectAlpha(testCanvas);
      setImgMeta({ width: img.width, height: img.height, hasAlpha });

      // Default format: PNG input with alpha -> WEBP by default, else JPG or WEBP
      const isPng = selected.type === 'image/png' || /\.png$/i.test(selected.name);
      const isWebp = selected.type === 'image/webp' || /\.webp$/i.test(selected.name);

      if (isWebp || (isPng && hasAlpha)) {
        setFormat('image/webp');
      } else {
        setFormat('image/jpeg');
      }
    } catch {
      setMetaError('Could not read image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setImgMeta(null);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const effectiveMaxDim = (): number | undefined => {
    if (maxDimensionOpt === 'original') return undefined;
    if (maxDimensionOpt === 'custom') return customMaxDim > 0 ? customMaxDim : undefined;
    return parseInt(maxDimensionOpt, 10);
  };

  const handleCompress = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      setProgress(0.2);
      const res = await compressImage(file, {
        quality: quality / 100,
        maxDimension: effectiveMaxDim(),
        format,
      });
      setResultInfo(res);
      setProgress(1.0);
      return res.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-compress">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image or drag it here"
          hint="Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result && resultInfo ? (
            <ResultPanel
              blob={job.result}
              filename={resultInfo.filename}
              kind="image"
              originalSize={file.size}
              beforePreview={
                originalUrl ? (
                  <img src={originalUrl} alt={file.name} className="preview-media" />
                ) : null
              }
              onReset={handleReset}
            >
              {resultInfo.isLarger && (
                <div className="error-banner" style={{ marginBottom: '1.25rem', backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#eab308', color: 'inherit' }}>
                  <p style={{ margin: 0, fontWeight: 500 }}>
                    Notice: The compressed file is larger than the original input. This can occur when an image is already heavily compressed.
                  </p>
                  <div style={{ marginTop: '0.75rem' }}>
                    <Button variant="secondary" onClick={() => downloadBlob(file, file.name)}>
                      Keep and download original ({formatBytes(file.size)})
                    </Button>
                  </div>
                </div>
              )}
            </ResultPanel>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  Name: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {imgMeta && (
                  <>
                    <span className="meta-chip">
                      Dimensions: <strong>{imgMeta.width}×{imgMeta.height} px</strong>
                    </span>
                    {imgMeta.hasAlpha && (
                      <span className="meta-chip">
                        Transparency: <strong>Detected</strong>
                      </span>
                    )}
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Compressing image..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Quality" hint="Quality slider (default 75). Lower values produce smaller files.">
                    <Slider
                      value={quality}
                      min={5}
                      max={95}
                      step={1}
                      unit="%"
                      onChange={setQuality}
                    />
                  </Field>

                  <Field label="Max dimension" hint="Constrain the longest edge to reduce size further">
                    <Select
                      id={maxDimId}
                      value={maxDimensionOpt}
                      onChange={(e) => setMaxDimensionOpt(e.target.value as MaxDimensionOption)}
                      options={[
                        { value: 'original', label: 'Keep original dimensions' },
                        { value: '1920', label: '1920 px (Full HD)' },
                        { value: '1280', label: '1280 px (HD)' },
                        { value: '1080', label: '1080 px (Square / Social)' },
                        { value: '800', label: '800 px (Web)' },
                        { value: 'custom', label: 'Custom max dimension' },
                      ]}
                    />
                  </Field>

                  {maxDimensionOpt === 'custom' && (
                    <Field label="Custom max edge (px)">
                      <input
                        type="number"
                        min={50}
                        max={10000}
                        value={customMaxDim}
                        onChange={(e) => setCustomMaxDim(parseInt(e.target.value, 10) || 100)}
                        className="select"
                      />
                    </Field>
                  )}

                  <Field label="Output format">
                    <Select
                      id={formatId}
                      value={format}
                      onChange={(e) => setFormat(e.target.value as EncodableMime)}
                      options={[
                        { value: 'image/jpeg', label: 'JPG' },
                        { value: 'image/webp', label: 'WEBP (supports transparency)' },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      Compress image
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
