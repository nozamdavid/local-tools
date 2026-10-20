import { useState, useRef, useId, useCallback, useEffect } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { SegmentClient } from '../_segment/segmentClient';
import { processVideo } from '../_segment/videoProcessor';
import { compositeRemoveBackgroundFrame } from '../_segment/composite';
import type { VideoMaxResolution, FrameProcessingProgress } from '../_segment/types';
import styles from './Tool.module.css';

type OutputFormat = 'webm' | 'solid' | 'greenscreen';
type FpsOption = '30' | '24' | '15';

export default function RemoveBackgroundTool() {
  const meta = getToolMeta('remove-background');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [outputFormat, setOutputFormat] = useState<OutputFormat>('webm');
  const [solidColor, setSolidColor] = useState<string>('#ffffff');
  const [fps, setFps] = useState<FpsOption>('30');
  const [resolution, setResolution] = useState<VideoMaxResolution>('720p');

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const originalUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(resultBlob);

  const abortControllerRef = useRef<AbortController | null>(null);
  const segmentClientRef = useRef<SegmentClient | null>(null);

  const formatId = useId();
  const fpsId = useId();
  const resolutionId = useId();

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      segmentClientRef.current?.terminate();
    };
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setStatus('idle');
    setResultBlob(null);
    setError(null);

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt background removal.');
    }
  };

  const handleReset = useCallback(() => {
    abortControllerRef.current?.abort();
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setStatus('idle');
    setProgress(0);
    setProgressLabel('');
    setError(null);
    setResultBlob(null);
  }, []);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    segmentClientRef.current?.terminate();
    segmentClientRef.current = null;
    setStatus('idle');
    setProgress(0);
    setProgressLabel('');
  }, []);

  const handleProcess = async () => {
    if (!file || !originalUrl) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const segmentClient = new SegmentClient();
    segmentClientRef.current = segmentClient;

    setStatus('running');
    setProgress(0);
    setProgressLabel('Loading AI segmentation model...');
    setError(null);

    try {
      await segmentClient.init((p) => {
        if (p?.progress !== undefined) {
          setProgress(Math.min(0.99, p.progress / 100));
          setProgressLabel(`Downloading AI model: ${Math.round(p.progress)}%`);
        }
      });

      if (abortController.signal.aborted) return;

      const chosenFps = parseInt(fps, 10);
      const isWebm = outputFormat === 'webm';

      const blob = await processVideo({
        videoFile: file,
        videoUrl: originalUrl,
        fps: chosenFps,
        maxResolution: resolution,
        outputFormat: isWebm ? 'webm' : 'mp4',
        segmentClient,
        abortSignal: abortController.signal,
        onProgress: (p: FrameProcessingProgress) => {
          if (p.totalFrames > 0) {
            setProgress(p.currentFrame / p.totalFrames);
          }
          const etaText = p.etaSeconds && p.etaSeconds > 0 ? ` (ETA: ${formatDuration(p.etaSeconds)})` : '';
          setProgressLabel(`${p.statusText}${etaText}`);
        },
        compositeFn: (ctx, info) => {
          compositeRemoveBackgroundFrame(
            ctx,
            info.frameImageData,
            info.mask,
            info.width,
            info.height,
            outputFormat,
            solidColor
          );
        },
      });

      if (abortController.signal.aborted) return;

      setResultBlob(blob);
      setStatus('done');
    } catch (err: any) {
      console.error('Remove background error:', err);
      (window as any).__lastError = err;
      if (err?.message === 'Cancelled' || abortController.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      setError(msg || 'Failed to remove background from video.');
      setStatus('error');
    } finally {
      segmentClient.terminate();
      segmentClientRef.current = null;
    }
  };

  const outputExt = outputFormat === 'webm' ? 'webm' : 'mp4';
  const outputFilename = file ? withSuffix(file.name, '-nobg', outputExt) : `video-nobg.${outputExt}`;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="remove-background">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Removes video background locally using AI. Transparent WebM or custom background MP4."
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
              beforePreview={
                originalUrl ? (
                  <video controls src={originalUrl} className="preview-media" playsInline />
                ) : null
              }
              onReset={handleReset}
            >
              {outputFormat === 'webm' && resultUrl && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Transparent Output (Checkerboard Preview)
                  </div>
                  <div className={styles.checkerboardPreview}>
                    <video controls src={resultUrl} playsInline />
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
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      Duration: <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      Resolution: <strong>{videoMeta.width}x{videoMeta.height}</strong>
                    </span>
                  </>
                )}
              </div>

              {status === 'running' ? (
                <div className={styles.progressContainer}>
                  <ProgressBar value={progress} label={progressLabel || 'Processing video...'} />
                  <div className={styles.cancelRow}>
                    <Button variant="secondary" onClick={handleCancel}>
                      Cancel processing
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field
                    label="Output format"
                    hint="WebM preserves transparency. MP4 places the cutout on solid color or green screen."
                  >
                    <Select
                      id={formatId}
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                      options={[
                        { value: 'webm', label: 'WebM with transparency (VP8 alpha)' },
                        { value: 'solid', label: 'MP4 on solid color' },
                        { value: 'greenscreen', label: 'MP4 on green screen' },
                      ]}
                    />
                  </Field>

                  {outputFormat === 'solid' && (
                    <Field label="Background color" hint="Pick a solid background color for the subject.">
                      <div className={styles.colorPickerRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={solidColor}
                          onChange={(e) => setSolidColor(e.target.value)}
                        />
                        <input
                          type="text"
                          className={styles.hexInput}
                          value={solidColor}
                          onChange={(e) => setSolidColor(e.target.value)}
                          placeholder="#ffffff"
                        />
                      </div>
                    </Field>
                  )}

                  <Field label="Framerate (fps)" hint="Lower framerate processes faster. Capped at 30 fps.">
                    <Select
                      id={fpsId}
                      value={fps}
                      onChange={(e) => setFps(e.target.value as FpsOption)}
                      options={[
                        { value: '30', label: 'Original (capped at 30 fps)' },
                        { value: '24', label: '24 fps (Cinematic)' },
                        { value: '15', label: '15 fps (Fastest)' },
                      ]}
                    />
                  </Field>

                  <Field label="Max processing resolution" hint="Recommended 720p for fast AI segmentation.">
                    <Select
                      id={resolutionId}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as VideoMaxResolution)}
                      options={[
                        { value: '720p', label: '720p (HD - recommended)' },
                        { value: '480p', label: '480p (SD - fast)' },
                        { value: '1080p', label: '1080p (Full HD)' },
                        { value: 'original', label: 'Original resolution' },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleProcess}>
                      Remove background
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
