import { useState, useEffect, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { ResultPanel } from '../../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { decodeImage, canvasToBlob, IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { getDefaultFormat, formatOutputFile } from '../_basic';
import styles from '../_basic/basic.module.css';

interface RotateResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

type BgOption = 'transparent' | 'white' | 'black' | 'custom';

export default function RotateTool() {
  const meta = getToolMeta('img-rotate');
  const [file, setFile] = useState<File | null>(null);
  const [decodedImg, setDecodedImg] = useState<HTMLImageElement | null>(null);
  const [angle, setAngle] = useState<number>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);
  const [bgOption, setBgOption] = useState<BgOption>('transparent');
  const [customBgColor, setCustomBgColor] = useState<string>('#ffffff');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<RotateResult | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const bgSelectId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setDecodedImg(null);
    setResultInfo(null);
    setAngle(0);
    setFlipH(false);
    setFlipV(false);
    job.reset();

    try {
      const img = await decodeImage(selected);
      setDecodedImg(img);
    } catch {
      setMetaError('Could not decode image. The file may be corrupt or unsupported.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setDecodedImg(null);
    setAngle(0);
    setFlipH(false);
    setFlipV(false);
    setMetaError(null);
    setResultInfo(null);
    job.reset();
  };

  const rotateBy = (delta: number) => {
    let newAngle = (angle + delta) % 360;
    if (newAngle > 180) newAngle -= 360;
    if (newAngle < -180) newAngle += 360;
    setAngle(newAngle);
  };

  // Render to canvas (shared between live preview and full export)
  const drawTransformed = (
    img: HTMLImageElement,
    rotDeg: number,
    fH: boolean,
    fV: boolean,
    bg: BgOption,
    hexColor: string,
  ): HTMLCanvasElement => {
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));

    const w = img.width;
    const h = img.height;
    const newW = Math.max(1, Math.round(w * cos + h * sin));
    const newH = Math.max(1, Math.round(w * sin + h * cos));

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (bg !== 'transparent') {
      const color = bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : hexColor;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, newW, newH);
    }

    ctx.save();
    ctx.translate(newW / 2, newH / 2);
    ctx.scale(fH ? -1 : 1, fV ? -1 : 1);
    ctx.rotate(rad);
    ctx.drawImage(img, -w / 2, -h / 2);
    ctx.restore();

    return canvas;
  };

  // Live preview update
  useEffect(() => {
    if (!decodedImg || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const rendered = drawTransformed(decodedImg, angle, flipH, flipV, bgOption, customBgColor);

    // Limit preview canvas display resolution for smooth interactive rendering
    const maxPreviewDim = 400;
    const previewScale = Math.min(1, maxPreviewDim / Math.max(rendered.width, rendered.height));
    canvas.width = Math.round(rendered.width * previewScale);
    canvas.height = Math.round(rendered.height * previewScale);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    }
  }, [decodedImg, angle, flipH, flipV, bgOption, customBgColor]);

  const handleApply = () => {
    if (!file || !decodedImg) return;

    job.run(async (setProgress) => {
      setProgress(0.2);
      const canvas = drawTransformed(decodedImg, angle, flipH, flipV, bgOption, customBgColor);
      setProgress(0.6);

      const defaultFmt = getDefaultFormat(file, 'image/png');
      // If transparent background is chosen, use PNG (or WEBP if original was WEBP)
      let outMime: EncodableMime = defaultFmt.mime;
      if (bgOption === 'transparent' && outMime === 'image/jpeg') {
        outMime = 'image/png';
      }

      const ext = outMime === 'image/jpeg' ? 'jpg' : outMime === 'image/webp' ? 'webp' : 'png';
      const blob = await canvasToBlob(canvas, outMime, outMime === 'image/png' ? undefined : 0.9);
      setProgress(1.0);

      const info: RotateResult = {
        blob,
        filename: formatOutputFile(file.name, '-rotated', ext),
        width: canvas.width,
        height: canvas.height,
      };
      setResultInfo(info);
      return blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-rotate">
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
              <div className="meta-chips" style={{ marginBottom: '1rem' }}>
                <span className="meta-chip">
                  Rotation: <strong>{angle}°</strong>
                </span>
                <span className="meta-chip">
                  New dimensions: <strong>{resultInfo.width}×{resultInfo.height} px</strong>
                </span>
              </div>
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
                {decodedImg && (
                  <span className="meta-chip">
                    Dimensions: <strong>{decodedImg.width}×{decodedImg.height} px</strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Applying rotation..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Live preview */}
                  <div className={styles.livePreviewContainer}>
                    <canvas
                      ref={previewCanvasRef}
                      style={{ maxWidth: '100%', maxHeight: '420px', objectFit: 'contain' }}
                    />
                  </div>

                  {/* Preset buttons */}
                  <Field label="Quick rotate">
                    <div className={styles.btnGroup}>
                      <Button variant="secondary" onClick={() => rotateBy(-90)}>
                        ↶ 90° Left
                      </Button>
                      <Button variant="secondary" onClick={() => rotateBy(90)}>
                        ↷ 90° Right
                      </Button>
                      <Button variant="secondary" onClick={() => rotateBy(180)}>
                        ↻ 180°
                      </Button>
                      <Button variant="secondary" onClick={() => setAngle(0)} disabled={angle === 0}>
                        Reset angle (0°)
                      </Button>
                    </div>
                  </Field>

                  {/* Free angle slider */}
                  <Field label={`Free angle: ${angle}°`} hint="Adjust angle freely with automatic canvas expansion to fit">
                    <Slider
                      value={angle}
                      min={-180}
                      max={180}
                      step={1}
                      unit="°"
                      onChange={setAngle}
                    />
                  </Field>

                  {/* Flip toggles */}
                  <Field label="Flip image">
                    <div className={styles.btnGroup}>
                      <button
                        type="button"
                        className={`${styles.presetChip} ${flipH ? styles.presetChipActive : ''}`}
                        onClick={() => setFlipH(!flipH)}
                      >
                        ↔ Flip Horizontal
                      </button>
                      <button
                        type="button"
                        className={`${styles.presetChip} ${flipV ? styles.presetChipActive : ''}`}
                        onClick={() => setFlipV(!flipV)}
                      >
                        ↕ Flip Vertical
                      </button>
                    </div>
                  </Field>

                  {/* Background option */}
                  <Field label="Background fill" hint="Color for uncovered corner areas created by angle rotation">
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <Select
                        id={bgSelectId}
                        value={bgOption}
                        onChange={(e) => setBgOption(e.target.value as BgOption)}
                        options={[
                          { value: 'transparent', label: 'Transparent (outputs PNG)' },
                          { value: 'white', label: 'White' },
                          { value: 'black', label: 'Black' },
                          { value: 'custom', label: 'Custom color' },
                        ]}
                      />
                      {bgOption === 'custom' && (
                        <input
                          type="color"
                          value={customBgColor}
                          onChange={(e) => setCustomBgColor(e.target.value)}
                          style={{ width: '44px', height: '38px', padding: 0, border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                        />
                      )}
                    </div>
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different image
                    </Button>
                    <Button variant="primary" onClick={handleApply}>
                      Save rotated image
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
