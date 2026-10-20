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

type TrimMode = 'precise' | 'fast';

export default function TrimTool() {
  const meta = getToolMeta('trim');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [mode, setMode] = useState<TrimMode>('precise');
  const [activeThumb, setActiveThumb] = useState<'start' | 'end'>('start');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const modeId = useId();

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
      setStartTime(0);
      setEndTime(parseFloat(vMeta.duration.toFixed(1)));
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt trimming.');
      setStartTime(0);
      setEndTime(10);
    }
  };

  const handleReset = () => {
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setStartTime(0);
    setEndTime(0);
    job.reset();
  };

  const seekPreview = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleStartChange = (val: number) => {
    const clamped = Math.max(0, Math.min(val, endTime));
    const rounded = parseFloat(clamped.toFixed(1));
    setStartTime(rounded);
    seekPreview(rounded);
  };

  const handleEndChange = (val: number) => {
    const maxDur = videoMeta ? videoMeta.duration : Math.max(val, startTime);
    const clamped = Math.min(maxDur, Math.max(val, startTime));
    const rounded = parseFloat(clamped.toFixed(1));
    setEndTime(rounded);
    seekPreview(rounded);
  };

  const handleSetStartToPlayhead = () => {
    if (!videoRef.current) return;
    const current = parseFloat(videoRef.current.currentTime.toFixed(1));
    handleStartChange(current);
  };

  const handleSetEndToPlayhead = () => {
    if (!videoRef.current) return;
    const current = parseFloat(videoRef.current.currentTime.toFixed(1));
    handleEndChange(current);
  };

  const handleTrim = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-trimmed', 'mp4');

      let args: string[];
      if (mode === 'fast') {
        const duration = Math.max(0.1, endTime - startTime);
        args = [
          '-ss',
          startTime.toFixed(2),
          '-t',
          duration.toFixed(2),
          '-i',
          inputName,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          outputName,
        ];
      } else {
        args = [
          '-i',
          inputName,
          '-ss',
          startTime.toFixed(2),
          '-to',
          endTime.toFixed(2),
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
      }

      return await runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  const totalDuration = videoMeta?.duration || Math.max(endTime, 1);
  const selectedDuration = Math.max(0, endTime - startTime);
  const startPercent = Math.max(0, Math.min(100, (startTime / totalDuration) * 100));
  const endPercent = Math.max(0, Math.min(100, (endTime / totalDuration) * 100));

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="trim">
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
              filename={withSuffix(file.name, '-trimmed', 'mp4')}
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
                      Resolution: <strong>{videoMeta.width}x{videoMeta.height}</strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Trimming video..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.videoContainer}>
                    {originalUrl && (
                      <video
                        ref={videoRef}
                        src={originalUrl}
                        controls
                        playsInline
                        className="preview-media"
                      />
                    )}
                  </div>

                  <div className={styles.durationBadge}>
                    <span>Selected duration:</span>
                    <strong>{formatDuration(selectedDuration)}</strong>
                    <span>({selectedDuration.toFixed(1)}s)</span>
                  </div>

                  {/* Dual handle range slider */}
                  <div className={styles.timelineContainer}>
                    <div className={styles.timelineTrack} />
                    <div
                      className={styles.timelineProgress}
                      style={{
                        left: `${startPercent}%`,
                        width: `${Math.max(0, endPercent - startPercent)}%`,
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={totalDuration}
                      step={0.1}
                      value={startTime}
                      className={styles.rangeInput}
                      style={{ zIndex: activeThumb === 'start' ? 3 : 2 }}
                      onPointerDown={() => setActiveThumb('start')}
                      onChange={(e) => handleStartChange(parseFloat(e.target.value))}
                      aria-label="Trim start time"
                    />
                    <input
                      type="range"
                      min={0}
                      max={totalDuration}
                      step={0.1}
                      value={endTime}
                      className={styles.rangeInput}
                      style={{ zIndex: activeThumb === 'end' ? 3 : 2 }}
                      onPointerDown={() => setActiveThumb('end')}
                      onChange={(e) => handleEndChange(parseFloat(e.target.value))}
                      aria-label="Trim end time"
                    />
                  </div>

                  {/* Numeric Inputs and Playhead buttons */}
                  <div className={styles.timeControls}>
                    <div className={styles.timeBox}>
                      <div className={styles.timeHeader}>
                        <span>Start point</span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleSetStartToPlayhead}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          Set to playhead
                        </Button>
                      </div>
                      <div className={styles.timeInputs}>
                        <input
                          type="number"
                          min={0}
                          max={endTime}
                          step={0.1}
                          value={startTime}
                          className={styles.numInput}
                          onChange={(e) => handleStartChange(parseFloat(e.target.value) || 0)}
                          aria-label="Start time in seconds"
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>sec</span>
                      </div>
                    </div>

                    <div className={styles.timeBox}>
                      <div className={styles.timeHeader}>
                        <span>End point</span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleSetEndToPlayhead}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          Set to playhead
                        </Button>
                      </div>
                      <div className={styles.timeInputs}>
                        <input
                          type="number"
                          min={startTime}
                          max={totalDuration}
                          step={0.1}
                          value={endTime}
                          className={styles.numInput}
                          onChange={(e) => handleEndChange(parseFloat(e.target.value) || 0)}
                          aria-label="End time in seconds"
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>sec</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '1.5rem' }}>
                    <Field
                      label="Trim mode"
                      hint="Precise re-encodes frames for exact cutting. Fast copies bitstream at keyframes without re-encoding."
                    >
                      <Select
                        id={modeId}
                        value={mode}
                        onChange={(e) => setMode(e.target.value as TrimMode)}
                        options={[
                          { value: 'precise', label: 'Precise (re-encode) - Default' },
                          { value: 'fast', label: 'Fast (keyframe cut, no re-encode)' },
                        ]}
                      />
                    </Field>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleTrim}>
                      Trim video
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
