import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { SegmentClient } from '../_segment/segmentClient';
import { processVideo } from '../_segment/videoProcessor';
import { drawTextLayers, drawSubjectOnTop, calculateTargetSize } from '../_segment/composite';
import type { TextLayer, VideoMaxResolution, FrameProcessingProgress } from '../_segment/types';
import styles from './Tool.module.css';

const SYSTEM_FONTS = [
  { value: 'Impact, sans-serif', label: 'Impact (Bold Poster)' },
  { value: 'Arial, sans-serif', label: 'Arial (Clean Sans)' },
  { value: 'Montserrat, sans-serif', label: 'Montserrat (Modern Sans)' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Georgia, serif', label: 'Georgia (Editorial Serif)' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Courier New, monospace', label: 'Courier New (Monospace)' },
];

const FONT_WEIGHTS = [
  { value: '400', label: 'Regular (400)' },
  { value: '600', label: 'Semi-Bold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '900', label: 'Black / Heavy (900)' },
];

type FpsOption = '30' | '24' | '15';

export default function TextBehindVideoTool() {
  const meta = getToolMeta('text-behind-video');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [loadingLabel, setLoadingLabel] = useState<string>('');

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [processProgress, setProcessProgress] = useState<number>(0);
  const [processLabel, setProcessLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const [fps, setFps] = useState<FpsOption>('30');
  const [resolution, setResolution] = useState<VideoMaxResolution>('720p');

  const [textLayer, setTextLayer] = useState<TextLayer>({
    id: 'layer-video',
    text: 'CINEMATIC',
    fontFamily: 'Impact, sans-serif',
    fontSize: 72,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 4,
    opacity: 1,
    rotation: 0,
    x: 0.5,
    y: 0.38,
  });

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstFrameDataRef = useRef<ImageData | null>(null);
  const firstFrameMaskRef = useRef<Uint8ClampedArray | null>(null);
  const previewSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const isDraggingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const segmentClientRef = useRef<SegmentClient | null>(null);

  const originalUrl = useObjectUrl(file);

  const canvasHintId = useId();
  const fontId = useId();
  const weightId = useId();
  const fpsId = useId();
  const resId = useId();

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      segmentClientRef.current?.terminate();
    };
  }, []);

  const updateTextLayer = (patch: Partial<TextLayer>) => {
    setTextLayer((prev) => ({ ...prev, ...patch }));
  };

  // Render preview on the first frame
  const renderFirstFramePreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const frameData = firstFrameDataRef.current;
    const mask = firstFrameMaskRef.current;
    const size = previewSizeRef.current;

    if (!canvas || !frameData || !mask || size.width === 0) return;

    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Draw base frame
    ctx.putImageData(frameData, 0, 0);

    // 2. Draw text behind
    drawTextLayers(ctx, [textLayer], size.width, size.height, 1);

    // 3. Draw subject on top
    drawSubjectOnTop(ctx, frameData, mask, size.width, size.height);
  }, [textLayer]);

  useEffect(() => {
    if (firstFrameDataRef.current && firstFrameMaskRef.current) {
      renderFirstFramePreview();
    }
  }, [textLayer, renderFirstFramePreview]);

  // Extract first frame and segment it
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setStatus('idle');
    setResultBlob(null);
    setError(null);
    firstFrameDataRef.current = null;
    firstFrameMaskRef.current = null;

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      setMetaError('Could not read video metadata, but you can still proceed.');
    }

    const objectUrl = URL.createObjectURL(selected);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    setLoadingPreview(true);
    setLoadingProgress(0);
    setLoadingLabel('Loading video & initializing AI model...');

    const client = new SegmentClient();
    segmentClientRef.current = client;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video file'));
      });

      // Seek to first frame
      video.currentTime = 0.001;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      await client.init((p) => {
        if (p?.progress !== undefined) {
          setLoadingProgress(Math.min(0.99, p.progress / 100));
          setLoadingLabel(`Loading AI model: ${Math.round(p.progress)}%`);
        }
      });

      setLoadingLabel('Segmenting subject on initial frame...');
      setLoadingProgress(0.5);

      const targetSize = calculateTargetSize(video.videoWidth, video.videoHeight, resolution);
      previewSizeRef.current = targetSize;

      const scratch = document.createElement('canvas');
      scratch.width = targetSize.width;
      scratch.height = targetSize.height;
      const sCtx = scratch.getContext('2d', { willReadFrequently: true });
      if (!sCtx) throw new Error('Could not create canvas context');

      sCtx.drawImage(video, 0, 0, targetSize.width, targetSize.height);
      const frameData = sCtx.getImageData(0, 0, targetSize.width, targetSize.height);
      firstFrameDataRef.current = frameData;

      const { mask } = await client.segmentFrame(frameData.data, targetSize.width, targetSize.height);
      firstFrameMaskRef.current = mask;

      setLoadingPreview(false);
      setLoadingProgress(1);
    } catch (err: any) {
      setError(err?.message || 'Failed to prepare video preview.');
      setLoadingPreview(false);
    } finally {
      client.terminate();
      segmentClientRef.current = null;
      URL.revokeObjectURL(objectUrl);
    }
  };

  // Canvas pointer dragging
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    updatePosFromPointer(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    updatePosFromPointer(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    previewCanvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const updatePosFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    updateTextLayer({ x, y });
  };

  // Keyboard equivalent of dragging: arrow keys nudge the text by 1% of the frame (5% with Shift).
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    setTextLayer((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(1, prev.x + dx)),
      y: Math.max(0, Math.min(1, prev.y + dy)),
    }));
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setStatus('idle');
    setProcessProgress(0);
    setProcessLabel('');
  };

  const handleReset = () => {
    abortControllerRef.current?.abort();
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setStatus('idle');
    setResultBlob(null);
    setError(null);
    firstFrameDataRef.current = null;
    firstFrameMaskRef.current = null;
  };

  const handleProcessVideo = async () => {
    if (!file || !originalUrl) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const segmentClient = new SegmentClient();
    segmentClientRef.current = segmentClient;

    setStatus('running');
    setProcessProgress(0);
    setProcessLabel('Initializing AI segmentation engine...');
    setError(null);

    try {
      await segmentClient.init();

      if (abortController.signal.aborted) return;

      const chosenFps = parseInt(fps, 10);

      const blob = await processVideo({
        videoFile: file,
        videoUrl: originalUrl,
        fps: chosenFps,
        maxResolution: resolution,
        outputFormat: 'mp4',
        segmentClient,
        abortSignal: abortController.signal,
        onProgress: (p: FrameProcessingProgress) => {
          if (p.totalFrames > 0) {
            setProcessProgress(p.currentFrame / p.totalFrames);
          }
          const etaText = p.etaSeconds && p.etaSeconds > 0 ? ` (ETA: ${formatDuration(p.etaSeconds)})` : '';
          setProcessLabel(`${p.statusText}${etaText}`);
        },
        compositeFn: (ctx, info) => {
          // 1. Draw frame
          ctx.putImageData(info.frameImageData, 0, 0);
          // 2. Draw text behind
          drawTextLayers(ctx, [textLayer], info.width, info.height, 1);
          // 3. Draw subject with alpha mask on top
          drawSubjectOnTop(ctx, info.frameImageData, info.mask, info.width, info.height);
        },
      });

      if (abortController.signal.aborted) return;

      setResultBlob(blob);
      setStatus('done');
    } catch (err: any) {
      if (err?.message === 'Cancelled' || abortController.signal.aborted) {
        setStatus('idle');
        return;
      }
      setError(err?.message || 'Failed to render text behind video.');
      setStatus('error');
    } finally {
      segmentClient.terminate();
      segmentClientRef.current = null;
    }
  };

  const outputFilename = file ? withSuffix(file.name, '-text-behind', 'mp4') : 'video-text-behind.mp4';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="text-behind-video">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Place dynamic typography behind the subject in your video. 100% in-browser processing."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {error && <div className="error-banner">{error}</div>}

          {status === 'done' && resultBlob ? (
            <ResultPanel
              blob={resultBlob}
              filename={outputFilename}
              kind="video"
              originalSize={file.size}
              beforePreview={originalUrl ? <video controls src={originalUrl} className="preview-media" playsInline /> : null}
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
                      Resolution:{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              {loadingPreview ? (
                <div style={{ marginTop: '2rem' }}>
                  <ProgressBar value={loadingProgress} label={loadingLabel} />
                </div>
              ) : status === 'running' ? (
                <div className={styles.progressContainer}>
                  <ProgressBar value={processProgress} label={processLabel || 'Processing video...'} />
                  <div className={styles.cancelRow}>
                    <Button variant="secondary" onClick={handleCancel}>
                      Cancel processing
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.editorLayout}>
                  {/* Left: Canvas Preview */}
                  <div className={styles.canvasWrapper}>
                    <div className={styles.canvasHint} id={canvasHintId}>
                      Live Preview (Frame 1): Drag to reposition text behind subject. With the preview focused, use the arrow keys to move
                      it (Shift for larger steps).
                    </div>
                    <canvas
                      ref={previewCanvasRef}
                      className={styles.canvas}
                      tabIndex={0}
                      role="img"
                      aria-label="Live preview of the first video frame with the text placed behind the subject"
                      aria-describedby={canvasHintId}
                      onKeyDown={handleCanvasKeyDown}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    />

                    <div className="action-buttons" style={{ marginTop: '1.5rem', width: '100%' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose another video
                      </Button>
                      <Button variant="primary" onClick={handleProcessVideo}>
                        Render full video
                      </Button>
                    </div>
                  </div>

                  {/* Right: Controls */}
                  <div className={styles.controlsPanel}>
                    <Field label="Text content">
                      <input
                        type="text"
                        className="select"
                        style={{ padding: '8px 12px' }}
                        value={textLayer.text}
                        onChange={(e) => updateTextLayer({ text: e.target.value })}
                        placeholder="Enter text..."
                      />
                    </Field>

                    <Field label="Font family">
                      <Select
                        id={fontId}
                        value={textLayer.fontFamily}
                        onChange={(e) => updateTextLayer({ fontFamily: e.target.value })}
                        options={SYSTEM_FONTS}
                      />
                    </Field>

                    <div className={styles.rowInputs}>
                      <Field label="Font weight">
                        <Select
                          id={weightId}
                          value={textLayer.fontWeight}
                          onChange={(e) => updateTextLayer({ fontWeight: e.target.value })}
                          options={FONT_WEIGHTS}
                        />
                      </Field>

                      <Field label="Color">
                        <div className={styles.colorPickerRow}>
                          <input
                            type="color"
                            className={styles.colorInput}
                            value={textLayer.color}
                            onChange={(e) => updateTextLayer({ color: e.target.value })}
                          />
                          <input
                            type="text"
                            className={styles.hexInput}
                            value={textLayer.color}
                            onChange={(e) => updateTextLayer({ color: e.target.value })}
                          />
                        </div>
                      </Field>
                    </div>

                    <Field label="Font size">
                      <Slider
                        value={textLayer.fontSize}
                        min={12}
                        max={300}
                        step={2}
                        unit="px"
                        onChange={(val) => updateTextLayer({ fontSize: val })}
                      />
                    </Field>

                    <Field label="Letter spacing">
                      <Slider
                        value={textLayer.letterSpacing}
                        min={-5}
                        max={40}
                        step={1}
                        unit="px"
                        onChange={(val) => updateTextLayer({ letterSpacing: val })}
                      />
                    </Field>

                    <Field label="Opacity">
                      <Slider
                        value={Math.round(textLayer.opacity * 100)}
                        min={0}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(val) => updateTextLayer({ opacity: val / 100 })}
                      />
                    </Field>

                    <Field label="Rotation">
                      <Slider
                        value={textLayer.rotation}
                        min={-180}
                        max={180}
                        step={1}
                        unit="°"
                        onChange={(val) => updateTextLayer({ rotation: val })}
                      />
                    </Field>

                    <div className={styles.rowInputs}>
                      <Field label="Framerate (fps)">
                        <Select
                          id={fpsId}
                          value={fps}
                          onChange={(e) => setFps(e.target.value as FpsOption)}
                          options={[
                            { value: '30', label: '30 fps' },
                            { value: '24', label: '24 fps' },
                            { value: '15', label: '15 fps (Fast)' },
                          ]}
                        />
                      </Field>

                      <Field label="Resolution">
                        <Select
                          id={resId}
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value as VideoMaxResolution)}
                          options={[
                            { value: '720p', label: '720p (HD)' },
                            { value: '480p', label: '480p (SD - Fast)' },
                            { value: '1080p', label: '1080p (Full HD)' },
                            { value: 'original', label: 'Original' },
                          ]}
                        />
                      </Field>
                    </div>
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
