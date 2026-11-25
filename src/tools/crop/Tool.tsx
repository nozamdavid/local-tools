import { useState, useId, useRef, useEffect, type PointerEvent, type KeyboardEvent } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import styles from './Tool.module.css';
import { useI18n } from '../../lib/i18n';
import { centeredCrop, drawCrop, moveCrop, normalizeCrop, resizeCrop, type CropHandle, type CropRect } from './geometry';

type AspectPreset = 'free' | '1:1' | '9:16' | '16:9' | '4:5' | '4:3';

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

type CropOperation = {
  kind: 'move' | 'resize' | 'draw';
  handle?: CropHandle;
  pointerId: number;
  clientX: number;
  clientY: number;
  sourceX: number;
  sourceY: number;
  renderedWidth: number;
  renderedHeight: number;
  crop: CropRect;
};

const CROP_HANDLES: { handle: CropHandle; label: string; className: string }[] = [
  { handle: 'nw', label: 'top-left', className: 'handleNW' },
  { handle: 'n', label: 'top', className: 'handleN' },
  { handle: 'ne', label: 'top-right', className: 'handleNE' },
  { handle: 'e', label: 'right', className: 'handleE' },
  { handle: 'se', label: 'bottom-right', className: 'handleSE' },
  { handle: 's', label: 'bottom', className: 'handleS' },
  { handle: 'sw', label: 'bottom-left', className: 'handleSW' },
  { handle: 'w', label: 'left', className: 'handleW' },
];

export default function CropTool() {
  const { t } = useI18n();
  const meta = getToolMeta('crop');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [drawMode, setDrawMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [stageMaxHeight, setStageMaxHeight] = useState(480);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const operationRef = useRef<CropOperation | null>(null);
  const metadataRequestRef = useRef(0);
  const presetRef = useRef<AspectPreset>('free');
  const presetId = useId();

  const job = useJob();
  const originalUrl = useObjectUrl(file);
  const targetRatio = aspectPreset === 'free' ? null : ASPECT_RATIOS[aspectPreset].w / ASPECT_RATIOS[aspectPreset].h;
  const stageWidth = videoMeta ? Math.min(960, stageMaxHeight * (videoMeta.width / videoMeta.height)) : undefined;

  useEffect(() => {
    const updateStageHeight = () => setStageMaxHeight(Math.min(640, Math.max(120, window.innerHeight * 0.65)));
    updateStageHeight();
    window.addEventListener('resize', updateStageHeight);
    return () => window.removeEventListener('resize', updateStageHeight);
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    videoRef.current?.pause();
    operationRef.current = null;
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setPreviewError(null);
    setPlaying(false);
    setPlayhead(0);
    setPreviewDuration(0);
    setPreviewLoaded(false);
    setDrawMode(false);
    setCrop({ x: 0, y: 0, w: 0, h: 0 });
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      if (!Number.isFinite(vMeta.width) || !Number.isFinite(vMeta.height) || vMeta.width < 2 || vMeta.height < 2)
        throw new Error('Video dimensions are missing.');
      setVideoMeta(vMeta);
      const preset = presetRef.current;
      const ratio = preset === 'free' ? null : ASPECT_RATIOS[preset].w / ASPECT_RATIOS[preset].h;
      setCrop(centeredCrop({ width: vMeta.width, height: vMeta.height }, ratio));
    } catch {
      if (requestId !== metadataRequestRef.current) return;
      setMetaError('Could not read video dimensions. Choose a video with readable dimensions to crop.');
      setCrop({ x: 0, y: 0, w: 0, h: 0 });
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    operationRef.current = null;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setCrop({ x: 0, y: 0, w: 0, h: 0 });
    setDrawMode(false);
    setPlaying(false);
    setPlayhead(0);
    setPreviewDuration(0);
    setPreviewLoaded(false);
    setPreviewError(null);
    job.reset();
  };

  const handlePresetChange = (preset: AspectPreset) => {
    presetRef.current = preset;
    setAspectPreset(preset);
    if (videoMeta) {
      const ratio = preset === 'free' ? null : ASPECT_RATIOS[preset].w / ASPECT_RATIOS[preset].h;
      setCrop(centeredCrop({ width: videoMeta.width, height: videoMeta.height }, ratio));
    }
  };

  const handleCropPropChange = (prop: keyof CropRect, rawVal: number) => {
    if (!videoMeta) return;
    const val = isNaN(rawVal) ? 0 : rawVal;
    const targetRatio = aspectPreset !== 'free' ? ASPECT_RATIOS[aspectPreset].w / ASPECT_RATIOS[aspectPreset].h : null;

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

      return normalizeCrop({ x, y, w, h }, videoMeta);
    });
  };

  const beginPointerOperation = (e: PointerEvent<HTMLElement>, kind: CropOperation['kind'], handle?: CropHandle) => {
    if (!videoMeta || !videoRef.current || !stageRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = videoRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const startX = ((e.clientX - rect.left) / rect.width) * videoMeta.width;
    const startY = ((e.clientY - rect.top) / rect.height) * videoMeta.height;
    operationRef.current = {
      kind,
      handle,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      sourceX: startX,
      sourceY: startY,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      crop: { ...crop },
    };
    if (kind === 'draw') {
      setCrop(drawCrop(startX, startY, startX + 2, startY + 2, videoMeta, targetRatio));
    }
    stageRef.current.setPointerCapture(e.pointerId);
  };

  const handleStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (drawMode) beginPointerOperation(e, 'draw');
  };

  const handleStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== e.pointerId || !videoMeta) return;
    const deltaX = ((e.clientX - operation.clientX) / operation.renderedWidth) * videoMeta.width;
    const deltaY = ((e.clientY - operation.clientY) / operation.renderedHeight) * videoMeta.height;
    if (operation.kind === 'move') {
      setCrop(moveCrop(operation.crop, deltaX, deltaY, videoMeta));
    } else if (operation.kind === 'resize' && operation.handle) {
      setCrop(resizeCrop(operation.crop, operation.handle, deltaX, deltaY, videoMeta, targetRatio));
    } else if (operation.kind === 'draw') {
      setCrop(
        drawCrop(operation.sourceX, operation.sourceY, operation.sourceX + deltaX, operation.sourceY + deltaY, videoMeta, targetRatio),
      );
    }
  };

  const handleStagePointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const operation = operationRef.current;
    if (!operation || operation.pointerId !== e.pointerId) return;
    operationRef.current = null;
    if (operation.kind === 'draw') setDrawMode(false);
  };

  const handleCropKeyboard = (e: KeyboardEvent<HTMLElement>, handle?: CropHandle) => {
    if (!videoMeta) return;
    const step = e.shiftKey ? 10 : 2;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    } as const;
    const movement = delta[e.key as keyof typeof delta];
    if (!movement) return;
    e.preventDefault();
    e.stopPropagation();
    if (handle) setCrop((current) => resizeCrop(current, handle, movement[0], movement[1], videoMeta, targetRatio));
    else setCrop((current) => moveCrop(current, movement[0], movement[1], videoMeta));
  };

  const handleCrop = () => {
    if (!file || !videoMeta) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-cropped', 'mp4');

      const safeCrop = normalizeCrop(crop, videoMeta);
      const { x: safeX, y: safeY, w: safeW, h: safeH } = safeCrop;

      const args = [
        '-i',
        inputName,
        '-vf',
        `scale=${Math.floor(videoMeta.width / 2) * 2}:${Math.floor(videoMeta.height / 2) * 2},setsar=1,crop=${safeW}:${safeH}:${safeX}:${safeY}`,
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

      return withMediabunnyFallback(
        {
          input: file,
          output: 'mp4',
          video: { codec: 'avc', quality: 'high', forceTranscode: true, crop: { left: safeX, top: safeY, width: safeW, height: safeH } },
          audio: { codec: 'aac', bitrate: 128_000, forceTranscode: true },
          tracks: { video: 'primary', audio: 'all' },
          requireVideo: true,
          allowDiscardedTrackTypes: ['subtitle'],
          audioEncoderFallback: 'aac',
          onProgress: setProgress,
        },
        (onProgress) =>
          runFFmpegWithinMediaJob({
            inputs: [{ name: inputName, data: file }],
            args,
            output: outputName,
            onProgress,
          }),
      );
    });
  };

  const cropLeftPct = videoMeta ? (crop.x / videoMeta.width) * 100 : 0;
  const cropTopPct = videoMeta ? (crop.y / videoMeta.height) * 100 : 0;
  const cropWidthPct = videoMeta ? (crop.w / videoMeta.width) * 100 : 100;
  const cropHeightPct = videoMeta ? (crop.h / videoMeta.height) * 100 : 100;

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    setPreviewError(null);
    if (video.paused) void video.play().catch(() => setPreviewError('Could not play this video in the browser.'));
    else video.pause();
  };

  const seekPreview = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setPlayhead(time);
  };

  const handleResetCrop = () => {
    if (videoMeta) setCrop(centeredCrop(videoMeta, targetRatio));
    setDrawMode(false);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="crop">
      {!file ? (
        <FileDrop
          accept="video/*"
          label={t('Choose a video or drag it here')}
          hint={t('Supports MP4, MOV, WebM, MKV, AVI and more.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}
          {!videoMeta && !metaError && job.status !== 'running' && (
            <p className="field-hint" role="status">
              {t('Reading video dimensions...')}
            </p>
          )}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, '-cropped', 'mp4')}
              kind="video"
              originalSize={file.size}
              beforePreview={originalUrl ? <video controls src={originalUrl} className="preview-media" playsInline /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name:')} <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size:')} <strong>{formatBytes(file.size)}</strong>
                </span>
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      {t('Duration:')} <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      {t('Original:')}{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Cropping video...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.stageContainer}>
                    <div
                      ref={stageRef}
                      className={`${styles.stage} ${drawMode ? styles.drawing : ''}`}
                      style={videoMeta ? { width: `${stageWidth}px`, aspectRatio: `${videoMeta.width} / ${videoMeta.height}` } : undefined}
                      onPointerDown={handleStagePointerDown}
                      onPointerMove={handleStagePointerMove}
                      onPointerUp={handleStagePointerEnd}
                      onPointerCancel={handleStagePointerEnd}
                    >
                      {originalUrl && (
                        <video
                          ref={videoRef}
                          src={originalUrl}
                          playsInline
                          preload="metadata"
                          className={videoMeta ? styles.cropVideo : styles.fallbackVideo}
                          style={videoMeta ? { aspectRatio: `${videoMeta.width} / ${videoMeta.height}` } : undefined}
                          onLoadedMetadata={(event) => {
                            const video = event.currentTarget;
                            setPreviewDuration(Number.isFinite(video.duration) ? video.duration : 0);
                            setPlayhead(video.currentTime || 0);
                            setPreviewLoaded(true);
                          }}
                          onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                          onPlay={() => setPlaying(true)}
                          onPause={() => setPlaying(false)}
                          onError={() => setPreviewError('Could not load this video preview.')}
                        />
                      )}
                      {videoMeta && (
                        <div
                          className={`${styles.cropBox} ${drawMode ? styles.drawBox : ''}`}
                          style={{
                            left: `${cropLeftPct}%`,
                            top: `${cropTopPct}%`,
                            width: `${cropWidthPct}%`,
                            height: `${cropHeightPct}%`,
                            pointerEvents: drawMode ? 'none' : undefined,
                          }}
                          onPointerDown={(event) => beginPointerOperation(event, 'move')}
                          onKeyDown={(event) => handleCropKeyboard(event)}
                          tabIndex={drawMode ? -1 : 0}
                          role="group"
                          aria-label={t('Crop selection. Use arrow keys to move; focus a handle to resize.')}
                        >
                          <div className={styles.gridOverlay} />
                          {!drawMode &&
                            CROP_HANDLES.map(({ handle, label, className }) => (
                              <button
                                key={handle}
                                type="button"
                                className={`${styles.handle} ${styles[className as keyof typeof styles]}`}
                                aria-label={t(`Resize crop from ${label}`)}
                                onPointerDown={(event) => beginPointerOperation(event, 'resize', handle)}
                                onKeyDown={(event) => handleCropKeyboard(event, handle)}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                    <div className={styles.previewControls}>
                      <Button variant="secondary" onClick={togglePlayback} disabled={!originalUrl}>
                        {playing ? t('Pause preview') : t('Play preview')}
                      </Button>
                      <input
                        className={styles.seekInput}
                        type="range"
                        min={0}
                        max={previewDuration || 0}
                        step={0.01}
                        value={Math.min(playhead, previewDuration || 0)}
                        onChange={(event) => seekPreview(Number(event.target.value))}
                        aria-label={t('Seek video preview')}
                        disabled={!previewDuration}
                      />
                      <span className={styles.previewTime}>
                        {formatDuration(playhead)} / {formatDuration(previewDuration)}
                      </span>
                    </div>
                  </div>
                  {originalUrl && !previewLoaded && !previewError && (
                    <p className={styles.previewNote} role="status">
                      {t('Loading video preview...')}
                    </p>
                  )}
                  {videoMeta && <p className={styles.previewNote}>{t('Crop preview shows the source video; the export is re-encoded.')}</p>}
                  {previewError && <div className="error-banner">{t(previewError)}</div>}

                  <div className={styles.infoBadge}>
                    <span>{t('Crop size:')}</span>
                    <strong>
                      {crop.w} × {crop.h}
                    </strong>
                    <span>{t('(at X: {x}, Y: {y})', { x: crop.x, y: crop.y })}</span>
                  </div>

                  <Field label={t('Aspect ratio preset')} hint={t('Re-fits the largest centered box of that ratio.')}>
                    <Select
                      id={presetId}
                      value={aspectPreset}
                      onChange={(e) => handlePresetChange(e.target.value as AspectPreset)}
                      options={[
                        { value: 'free', label: t('Free (unconstrained)') },
                        { value: '1:1', label: t('1:1 Square') },
                        { value: '9:16', label: t('9:16 Story / TikTok / Reel') },
                        { value: '16:9', label: t('16:9 Widescreen / YouTube') },
                        { value: '4:5', label: t('4:5 Social Portrait') },
                        { value: '4:3', label: t('4:3 Classic Standard') },
                      ]}
                    />
                  </Field>

                  <div className={styles.cropActions}>
                    <Button
                      variant="secondary"
                      onClick={() => setDrawMode((active) => !active)}
                      disabled={!videoMeta}
                      aria-pressed={drawMode}
                    >
                      {drawMode ? t('Cancel drawing') : t('Draw new crop')}
                    </Button>
                    <Button variant="secondary" onClick={handleResetCrop} disabled={!videoMeta}>
                      {t('Reset crop')}
                    </Button>
                  </div>
                  {drawMode && <p className="field-hint">{t('Crop drawing active. Drag on the video to choose a new area.')}</p>}

                  <details className="tool-options">
                    <summary>{t('Fine-tune crop (optional)')}</summary>
                    <div className="tool-options-body">
                      <div className={styles.inputsGrid}>
                        <div className={styles.inputCard}>
                          <span className={styles.inputLabel}>{t('X position')}</span>
                          <input
                            type="number"
                            min={0}
                            max={videoMeta ? videoMeta.width - crop.w : undefined}
                            step={2}
                            value={crop.x}
                            className={styles.numInput}
                            onChange={(e) => handleCropPropChange('x', parseInt(e.target.value, 10))}
                            aria-label={t('Crop X position')}
                          />
                        </div>
                        <div className={styles.inputCard}>
                          <span className={styles.inputLabel}>{t('Y position')}</span>
                          <input
                            type="number"
                            min={0}
                            max={videoMeta ? videoMeta.height - crop.h : undefined}
                            step={2}
                            value={crop.y}
                            className={styles.numInput}
                            onChange={(e) => handleCropPropChange('y', parseInt(e.target.value, 10))}
                            aria-label={t('Crop Y position')}
                          />
                        </div>
                        <div className={styles.inputCard}>
                          <span className={styles.inputLabel}>{t('Width')}</span>
                          <input
                            type="number"
                            min={2}
                            max={videoMeta ? videoMeta.width - crop.x : undefined}
                            step={2}
                            value={crop.w}
                            className={styles.numInput}
                            onChange={(e) => handleCropPropChange('w', parseInt(e.target.value, 10))}
                            aria-label={t('Crop width')}
                          />
                        </div>
                        <div className={styles.inputCard}>
                          <span className={styles.inputLabel}>{t('Height')}</span>
                          <input
                            type="number"
                            min={2}
                            max={videoMeta ? videoMeta.height - crop.y : undefined}
                            step={2}
                            value={crop.h}
                            className={styles.numInput}
                            onChange={(e) => handleCropPropChange('h', parseInt(e.target.value, 10))}
                            aria-label={t('Crop height')}
                          />
                        </div>
                      </div>
                    </div>
                  </details>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleCrop} disabled={!videoMeta}>
                      {t('Crop video')}
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
