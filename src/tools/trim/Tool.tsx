import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg, runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import styles from './Tool.module.css';

type TrimMode = 'precise' | 'fast';

export default function TrimTool() {
  const { t } = useI18n();
  const meta = getToolMeta('trim');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [mode, setMode] = useState<TrimMode>('precise');
  const [activeThumb, setActiveThumb] = useState<'start' | 'end'>('start');
  const [rangePlaying, setRangePlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const metadataRequestRef = useRef(0);
  const modeId = useId();

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    videoRef.current?.pause();
    setRangePlaying(false);
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      setVideoMeta(vMeta);
      setStartTime(0);
      setEndTime(parseFloat(vMeta.duration.toFixed(1)));
    } catch {
      if (requestId !== metadataRequestRef.current) return;
      setMetaError('Could not read video metadata, but you can still attempt trimming.');
      setStartTime(0);
      setEndTime(10);
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    videoRef.current?.pause();
    setRangePlaying(false);
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

  const toggleRangePlayback = () => {
    const video = videoRef.current;
    if (!video || selectedDuration <= 0) return;
    if (rangePlaying) {
      video.pause();
      setRangePlaying(false);
      return;
    }
    video.currentTime = startTime;
    setRangePlaying(true);
    void video.play().catch(() => setRangePlaying(false));
  };

  const handlePreviewTimeUpdate = (video: HTMLVideoElement) => {
    if (rangePlaying && video.currentTime >= endTime) {
      video.currentTime = endTime;
      video.pause();
      setRangePlaying(false);
    }
  };

  const handleTrim = () => {
    if (!file || (!videoMeta && !metaError) || endTime <= startTime) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-trimmed', 'mp4');

      if (mode === 'fast') {
        const duration = Math.max(0.1, endTime - startTime);
        const args = [
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
        return runFFmpeg({
          inputs: [{ name: inputName, data: file }],
          args,
          output: outputName,
          onProgress: setProgress,
        });
      }

      const args = [
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

      return withMediabunnyFallback(
        {
          input: file,
          output: 'mp4',
          video: { codec: 'avc', quality: 'high', forceTranscode: true },
          audio: { codec: 'aac', bitrate: 128_000, forceTranscode: true },
          trim: { start: startTime, end: endTime },
          copy: false,
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

  const totalDuration = videoMeta?.duration || Math.max(endTime, 1);
  const selectedDuration = Math.max(0, endTime - startTime);
  const startPercent = Math.max(0, Math.min(100, (startTime / totalDuration) * 100));
  const endPercent = Math.max(0, Math.min(100, (endTime / totalDuration) * 100));

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="trim">
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

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, '-trimmed', 'mp4')}
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
                      {t('Resolution:')}{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Trimming video...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.videoContainer}>
                    {originalUrl && (
                      <video
                        ref={videoRef}
                        src={originalUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="preview-media"
                        onTimeUpdate={(event) => handlePreviewTimeUpdate(event.currentTarget)}
                        onEnded={() => setRangePlaying(false)}
                        onPause={() => setRangePlaying(false)}
                      />
                    )}
                  </div>

                  <div className={styles.rangePlayback}>
                    <Button variant="secondary" onClick={toggleRangePlayback} disabled={selectedDuration <= 0}>
                      {rangePlaying ? t('Stop range playback') : t('Play selected range')}
                    </Button>
                    <span>
                      {t('Preview plays from {start} to {end}.', { start: `${startTime.toFixed(1)}s`, end: `${endTime.toFixed(1)}s` })}
                    </span>
                  </div>
                  {mode === 'fast' && (
                    <p className="field-hint">{t('Fast export may cut at a nearby keyframe; range preview follows the selected times.')}</p>
                  )}

                  <div className={styles.durationBadge}>
                    <span>{t('Selected duration:')}</span>
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
                      aria-label={t('Trim start time')}
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
                      aria-label={t('Trim end time')}
                    />
                  </div>

                  {/* Numeric Inputs and Playhead buttons */}
                  <div className={styles.timeControls}>
                    <div className={styles.timeBox}>
                      <div className={styles.timeHeader}>
                        <span>{t('Start point')}</span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleSetStartToPlayhead}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          {t('Set to playhead')}
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
                          aria-label={t('Start time in seconds')}
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('sec')}</span>
                      </div>
                    </div>

                    <div className={styles.timeBox}>
                      <div className={styles.timeHeader}>
                        <span>{t('End point')}</span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleSetEndToPlayhead}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          {t('Set to playhead')}
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
                          aria-label={t('End time in seconds')}
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('sec')}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '1.5rem' }}>
                    <Field
                      label={t('Trim mode')}
                      hint={t('Precise re-encodes frames for exact cutting. Fast copies bitstream at keyframes without re-encoding.')}
                    >
                      <Select
                        id={modeId}
                        value={mode}
                        onChange={(e) => setMode(e.target.value as TrimMode)}
                        options={[
                          { value: 'precise', label: t('Precise (re-encode) - Default') },
                          { value: 'fast', label: t('Fast (keyframe cut, no re-encode)') },
                        ]}
                      />
                    </Field>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleTrim} disabled={(!videoMeta && !metaError) || endTime <= startTime}>
                      {t('Trim video')}
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
