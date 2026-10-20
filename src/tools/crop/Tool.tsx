import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import styles from './Tool.module.css';

type AspectPreset = 'free' | '1:1' | '9:16' | '16:9' | '4:5' | '4:3';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ASPECT_RATIOS: Record<Exclude<AspectPreset, 'free'>, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '9:16': { w: 9, h: 16 },
  '16:9': { w: 16, h: 9 },
  '4:5': { w: 4, h: 5 },
  '4:3': { w: 4, h: 3 },
};

function toEven(n: number): number {
  return Math.floor(n / 2) * 2;
}

function computeCenteredCrop(srcW: number, srcH: number, preset: AspectPreset): CropRect {
  const safeSrcW = Math.max(2, toEven(srcW));
  const safeSrcH = Math.max(2, toEven(srcH));

  if (preset === 'free') {
    return { x: 0, y: 0, w: safeSrcW, h: safeSrcH };
  }

  const { w: rw, h: rh } = ASPECT_RATIOS[preset];
  const targetRatio = rw / rh;
  const srcRatio = safeSrcW / safeSrcH;

  let w: number;
  let h: number;

  if (srcRatio > targetRatio) {
    h = safeSrcH;
    w = toEven(Math.round(h * targetRatio));
    if (w > safeSrcW) {
      w = safeSrcW;
      h = toEven(Math.round(w / targetRatio));
    }
  } else {
    w = safeSrcW;
    h = toEven(Math.round(w / targetRatio));
    if (h > safeSrcH) {
      h = safeSrcH;
      w = toEven(Math.round(h * targetRatio));
    }
  }

  w = Math.max(2, Math.min(safeSrcW, w));
  h = Math.max(2, Math.min(safeSrcH, h));

  const x = Math.max(0, toEven(Math.round((safeSrcW - w) / 2)));
  const y = Math.max(0, toEven(Math.round((safeSrcH - h) / 2)));

  return { x, y, w, h };
}

export default function CropTool() {
  const meta = getToolMeta('crop');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const presetId = useId();

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
      const initialCrop = computeCenteredCrop(vMeta.width, vMeta.height, aspectPreset);
      setCrop(initialCrop);
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt cropping.');
      setCrop({ x: 0, y: 0, w: 640, h: 360 });
    }
  };

  const handleReset = () => {
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setCrop({ x: 0, y: 0, w: 0, h: 0 });
    job.reset();
  };

  const handlePresetChange = (preset: AspectPreset) => {
    setAspectPreset(preset);
    if (videoMeta) {
      setCrop(computeCenteredCrop(videoMeta.width, videoMeta.height, preset));
    }
  };

  const handleCropPropChange = (prop: keyof CropRect, rawVal: number) => {
    if (!videoMeta) return;
    const val = isNaN(rawVal) ? 0 : rawVal;
    const targetRatio =
      aspectPreset !== 'free'
        ? ASPECT_RATIOS[aspectPreset].w / ASPECT_RATIOS[aspectPreset].h
        : null;

    setCrop((prev) => {
      let { x, y, w, h } = prev;

      if (prop === 'x') {
        x = Math.max(0, Math.min(videoMeta.width - w, toEven(val)));
      } else if (prop === 'y') {
        y = Math.max(0, Math.min(videoMeta.height - h, toEven(val)));
      } else if (prop === 'w') {
        w = Math.max(2, Math.min(videoMeta.width - x, toEven(val)));
        if (targetRatio !== null) {
          h = toEven(Math.round(w / targetRatio));
          if (y + h > videoMeta.height) {
            h = toEven(videoMeta.height - y);
            w = toEven(Math.round(h * targetRatio));
          }
        }
      } else if (prop === 'h') {
        h = Math.max(2, Math.min(videoMeta.height - y, toEven(val)));
        if (targetRatio !== null) {
          w = toEven(Math.round(h * targetRatio));
          if (x + w > videoMeta.width) {
            w = toEven(videoMeta.width - x);
            h = toEven(Math.round(w / targetRatio));
          }
        }
      }

      return { x, y, w, h };
    });
  };

  const handleBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains(styles.handle)) return;

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialCrop = { ...crop };

    if (!videoRef.current || !videoMeta) return;
    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoMeta.width / rect.width;
    const scaleY = videoMeta.height / rect.height;

    const onPointerMove = (ev: PointerEvent) => {
      const deltaX = (ev.clientX - startX) * scaleX;
      const deltaY = (ev.clientY - startY) * scaleY;

      let newX = initialCrop.x + deltaX;
      let newY = initialCrop.y + deltaY;

      newX = Math.max(0, Math.min(videoMeta.width - initialCrop.w, newX));
      newY = Math.max(0, Math.min(videoMeta.height - initialCrop.h, newY));

      setCrop({
        x: toEven(Math.round(newX)),
        y: toEven(Math.round(newY)),
        w: initialCrop.w,
        h: initialCrop.h,
      });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleHandlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    handle: 'nw' | 'ne' | 'se' | 'sw'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialCrop = { ...crop };

    if (!videoRef.current || !videoMeta) return;
    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoMeta.width / rect.width;
    const scaleY = videoMeta.height / rect.height;

    const targetRatio =
      aspectPreset !== 'free'
        ? ASPECT_RATIOS[aspectPreset].w / ASPECT_RATIOS[aspectPreset].h
        : null;

    const onPointerMove = (ev: PointerEvent) => {
      const deltaX = (ev.clientX - startX) * scaleX;
      const deltaY = (ev.clientY - startY) * scaleY;

      let x = initialCrop.x;
      let y = initialCrop.y;
      let w = initialCrop.w;
      let h = initialCrop.h;

      if (handle === 'se') {
        let candW = initialCrop.w + deltaX;
        let candH = initialCrop.h + deltaY;

        if (targetRatio !== null) {
          const d = (deltaX + deltaY * targetRatio) / 2;
          candW = initialCrop.w + d;
          candH = candW / targetRatio;
        }

        candW = Math.max(16, Math.min(videoMeta.width - x, candW));
        candH = Math.max(16, Math.min(videoMeta.height - y, candH));

        if (targetRatio !== null) {
          if (candW / candH > targetRatio) {
            candW = candH * targetRatio;
          } else {
            candH = candW / targetRatio;
          }
        }

        w = Math.max(2, toEven(Math.round(candW)));
        h = Math.max(2, toEven(Math.round(candH)));
      } else if (handle === 'sw') {
        const anchorX = initialCrop.x + initialCrop.w;
        let candW = initialCrop.w - deltaX;
        let candH = initialCrop.h + deltaY;

        if (targetRatio !== null) {
          const d = (-deltaX + deltaY * targetRatio) / 2;
          candW = initialCrop.w + d;
          candH = candW / targetRatio;
        }

        candW = Math.max(16, Math.min(anchorX, candW));
        candH = Math.max(16, Math.min(videoMeta.height - y, candH));

        if (targetRatio !== null) {
          if (candW / candH > targetRatio) {
            candW = candH * targetRatio;
          } else {
            candH = candW / targetRatio;
          }
        }

        w = Math.max(2, toEven(Math.round(candW)));
        h = Math.max(2, toEven(Math.round(candH)));
        x = Math.max(0, toEven(anchorX - w));
      } else if (handle === 'ne') {
        const anchorY = initialCrop.y + initialCrop.h;
        let candW = initialCrop.w + deltaX;
        let candH = initialCrop.h - deltaY;

        if (targetRatio !== null) {
          const d = (deltaX - deltaY * targetRatio) / 2;
          candW = initialCrop.w + d;
          candH = candW / targetRatio;
        }

        candW = Math.max(16, Math.min(videoMeta.width - x, candW));
        candH = Math.max(16, Math.min(anchorY, candH));

        if (targetRatio !== null) {
          if (candW / candH > targetRatio) {
            candW = candH * targetRatio;
          } else {
            candH = candW / targetRatio;
          }
        }

        w = Math.max(2, toEven(Math.round(candW)));
        h = Math.max(2, toEven(Math.round(candH)));
        y = Math.max(0, toEven(anchorY - h));
      } else if (handle === 'nw') {
        const anchorX = initialCrop.x + initialCrop.w;
        const anchorY = initialCrop.y + initialCrop.h;
        let candW = initialCrop.w - deltaX;
        let candH = initialCrop.h - deltaY;

        if (targetRatio !== null) {
          const d = (-deltaX - deltaY * targetRatio) / 2;
          candW = initialCrop.w + d;
          candH = candW / targetRatio;
        }

        candW = Math.max(16, Math.min(anchorX, candW));
        candH = Math.max(16, Math.min(anchorY, candH));

        if (targetRatio !== null) {
          if (candW / candH > targetRatio) {
            candW = candH * targetRatio;
          } else {
            candH = candW / targetRatio;
          }
        }

        w = Math.max(2, toEven(Math.round(candW)));
        h = Math.max(2, toEven(Math.round(candH)));
        x = Math.max(0, toEven(anchorX - w));
        y = Math.max(0, toEven(anchorY - h));
      }

      setCrop({ x, y, w, h });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleCrop = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-cropped', 'mp4');

      const safeW = Math.max(2, toEven(crop.w));
      const safeH = Math.max(2, toEven(crop.h));
      const safeX = Math.max(0, toEven(crop.x));
      const safeY = Math.max(0, toEven(crop.y));

      const args = [
        '-i',
        inputName,
        '-vf',
        `crop=${safeW}:${safeH}:${safeX}:${safeY}`,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputName,
      ];

      return await runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  const cropLeftPct = videoMeta ? (crop.x / videoMeta.width) * 100 : 0;
  const cropTopPct = videoMeta ? (crop.y / videoMeta.height) * 100 : 0;
  const cropWidthPct = videoMeta ? (crop.w / videoMeta.width) * 100 : 100;
  const cropHeightPct = videoMeta ? (crop.h / videoMeta.height) * 100 : 100;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="crop">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Supports MP4, MOV, WebM, MKV, AVI and more. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, '-cropped', 'mp4')}
              kind="video"
              originalSize={file.size}
              beforePreview={
                originalUrl ? (
                  <video controls src={originalUrl} className="preview-media" playsInline />
                ) : null
              }
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  Name: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      Duration: <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      Original: <strong>{videoMeta.width}x{videoMeta.height}</strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Cropping video..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  {/* Video Stage with interactive crop box */}
                  <div className={styles.stageContainer}>
                    <div className={styles.stage}>
                      {originalUrl && (
                        <video
                          ref={videoRef}
                          src={originalUrl}
                          playsInline
                          controls
                          className="preview-media"
                        />
                      )}
                      {videoMeta && (
                        <div
                          className={styles.cropBox}
                          style={{
                            left: `${cropLeftPct}%`,
                            top: `${cropTopPct}%`,
                            width: `${cropWidthPct}%`,
                            height: `${cropHeightPct}%`,
                          }}
                          onPointerDown={handleBoxPointerDown}
                        >
                          <div className={styles.gridOverlay} />
                          <div
                            className={`${styles.handle} ${styles.handleNW}`}
                            onPointerDown={(e) => handleHandlePointerDown(e, 'nw')}
                            aria-label="Resize top-left"
                          />
                          <div
                            className={`${styles.handle} ${styles.handleNE}`}
                            onPointerDown={(e) => handleHandlePointerDown(e, 'ne')}
                            aria-label="Resize top-right"
                          />
                          <div
                            className={`${styles.handle} ${styles.handleSE}`}
                            onPointerDown={(e) => handleHandlePointerDown(e, 'se')}
                            aria-label="Resize bottom-right"
                          />
                          <div
                            className={`${styles.handle} ${styles.handleSW}`}
                            onPointerDown={(e) => handleHandlePointerDown(e, 'sw')}
                            aria-label="Resize bottom-left"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={styles.infoBadge}>
                    <span>Crop size:</span>
                    <strong>{crop.w} × {crop.h}</strong>
                    <span>(at X: {crop.x}, Y: {crop.y})</span>
                  </div>

                  <Field label="Aspect ratio preset" hint="Re-fits the largest centered box of that ratio.">
                    <Select
                      id={presetId}
                      value={aspectPreset}
                      onChange={(e) => handlePresetChange(e.target.value as AspectPreset)}
                      options={[
                        { value: 'free', label: 'Free (unconstrained)' },
                        { value: '1:1', label: '1:1 Square' },
                        { value: '9:16', label: '9:16 Story / TikTok / Reel' },
                        { value: '16:9', label: '16:9 Widescreen / YouTube' },
                        { value: '4:5', label: '4:5 Social Portrait' },
                        { value: '4:3', label: '4:3 Classic Standard' },
                      ]}
                    />
                  </Field>

                  {/* Numeric Inputs */}
                  <div className={styles.inputsGrid}>
                    <div className={styles.inputCard}>
                      <span className={styles.inputLabel}>X position</span>
                      <input
                        type="number"
                        min={0}
                        max={videoMeta ? videoMeta.width - crop.w : undefined}
                        step={2}
                        value={crop.x}
                        className={styles.numInput}
                        onChange={(e) => handleCropPropChange('x', parseInt(e.target.value, 10))}
                        aria-label="Crop X position"
                      />
                    </div>
                    <div className={styles.inputCard}>
                      <span className={styles.inputLabel}>Y position</span>
                      <input
                        type="number"
                        min={0}
                        max={videoMeta ? videoMeta.height - crop.h : undefined}
                        step={2}
                        value={crop.y}
                        className={styles.numInput}
                        onChange={(e) => handleCropPropChange('y', parseInt(e.target.value, 10))}
                        aria-label="Crop Y position"
                      />
                    </div>
                    <div className={styles.inputCard}>
                      <span className={styles.inputLabel}>Width</span>
                      <input
                        type="number"
                        min={2}
                        max={videoMeta ? videoMeta.width - crop.x : undefined}
                        step={2}
                        value={crop.w}
                        className={styles.numInput}
                        onChange={(e) => handleCropPropChange('w', parseInt(e.target.value, 10))}
                        aria-label="Crop width"
                      />
                    </div>
                    <div className={styles.inputCard}>
                      <span className={styles.inputLabel}>Height</span>
                      <input
                        type="number"
                        min={2}
                        max={videoMeta ? videoMeta.height - crop.y : undefined}
                        step={2}
                        value={crop.h}
                        className={styles.numInput}
                        onChange={(e) => handleCropPropChange('h', parseInt(e.target.value, 10))}
                        aria-label="Crop height"
                      />
                    </div>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleCrop}>
                      Crop video
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
