import { useState, useId, useRef, useEffect, useCallback } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import styles from './Tool.module.css';

const PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4];

const num = (n: number) => String(parseFloat(n.toFixed(4)));

// atempo only accepts 0.5–2.0 per stage, so split larger or smaller factors into a chain.
function buildAtempoChain(speed: number): string {
  const stages: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    stages.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }
  stages.push(remaining);
  return stages.map((s) => `atempo=${num(s)}`).join(',');
}

export default function SpeedTool() {
  const { t } = useI18n();
  const meta = getToolMeta('speed');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [speed, setSpeed] = useState<number>(2);
  const [keepAudio, setKeepAudio] = useState<boolean>(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRateUnsupported, setPreviewRateUnsupported] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const keepAudioId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    videoRef.current?.pause();
    setFile(selected);
    setMetaError(null);
    setPreviewError(null);
    setPreviewLoaded(false);
    setVideoMeta(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      setVideoMeta(vMeta);
    } catch {
      if (requestId !== metadataRequestRef.current) return;
      setMetaError('Could not read video metadata, but you can still attempt the speed change.');
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    videoRef.current?.pause();
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setPreviewError(null);
    setPreviewLoaded(false);
    job.reset();
  };

  const syncPreviewPlayback = useCallback(
    (video: HTMLVideoElement) => {
      try {
        video.playbackRate = speed;
        setPreviewRateUnsupported(Math.abs(video.playbackRate - speed) > 0.001);
      } catch {
        setPreviewRateUnsupported(true);
      }
      video.muted = !keepAudio;
      video.preservesPitch = true;
      const extendedVideo = video as HTMLVideoElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
      if ('webkitPreservesPitch' in extendedVideo) extendedVideo.webkitPreservesPitch = true;
      if ('mozPreservesPitch' in extendedVideo) extendedVideo.mozPreservesPitch = true;
    },
    [speed, keepAudio],
  );

  useEffect(() => {
    if (videoRef.current) syncPreviewPlayback(videoRef.current);
  }, [syncPreviewPlayback, originalUrl]);

  const outputFilename = file ? withSuffix(file.name, `-${num(speed)}x`, 'mp4') : '';

  const handleRun = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const dot = file.name.lastIndexOf('.');
      const inputExt = dot > 0 ? file.name.slice(dot).replace(/[^\w.]/g, '') : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = 'output.mp4';

      const videoArgs = [
        '-vf',
        `setpts=PTS/${num(speed)},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
      ];
      const audioArgs = keepAudio ? ['-af', buildAtempoChain(speed), '-c:a', 'aac', '-b:a', '128k'] : ['-an'];
      return runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args: ['-i', inputName, ...videoArgs, ...audioArgs, '-movflags', '+faststart', outputName],
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  const newDuration = videoMeta && videoMeta.duration > 0 ? videoMeta.duration / speed : null;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="speed">
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
              filename={outputFilename}
              kind="video"
              originalSize={file.size}
              beforePreview={originalUrl ? <video controls src={originalUrl} className="preview-media" playsInline /> : null}
              onReset={handleReset}
            >
              {newDuration !== null && (
                <div className="meta-chips">
                  <span className="meta-chip">
                    {t('New duration:')} <strong>{formatDuration(newDuration)}</strong>
                  </span>
                </div>
              )}
            </ResultPanel>
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
                <ProgressBar value={job.progress} label={t('Changing speed...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field
                    label={t('Speed')}
                    hint={
                      newDuration !== null
                        ? `Resulting duration: ${formatDuration(newDuration)}`
                        : 'Below 1x slows the video down, above 1x speeds it up.'
                    }
                  >
                    <div className={styles.presets}>
                      {PRESETS.map((p) => (
                        <Button
                          key={p}
                          variant={p === speed ? 'primary' : 'secondary'}
                          className={styles.preset}
                          onClick={() => setSpeed(p)}
                        >
                          {p}x
                        </Button>
                      ))}
                    </div>
                    <Slider value={speed} min={0.25} max={4} step={0.05} unit="x" onChange={(v) => setSpeed(parseFloat(v.toFixed(2)))} />
                  </Field>

                  <div className="field">
                    <label className="checkbox-label" htmlFor={keepAudioId}>
                      <input id={keepAudioId} type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
                      <span>{t('Keep audio')}</span>
                    </label>
                    <p className="field-hint">{t('Audio is sped up or slowed down with the video, keeping its pitch.')}</p>
                  </div>

                  <section className={styles.playbackPreview} aria-label={t('Speed preview')}>
                    <div className={styles.previewHeading}>
                      {t('Speed preview')} · {speed}x
                    </div>
                    {originalUrl && (
                      <video
                        ref={videoRef}
                        controls
                        playsInline
                        preload="metadata"
                        src={originalUrl}
                        className="preview-media"
                        muted={!keepAudio}
                        onLoadedMetadata={(event) => {
                          syncPreviewPlayback(event.currentTarget);
                          setPreviewLoaded(true);
                        }}
                        onPlay={(event) => syncPreviewPlayback(event.currentTarget)}
                        onVolumeChange={(event) => {
                          if (event.currentTarget.muted !== !keepAudio) event.currentTarget.muted = !keepAudio;
                        }}
                        onError={() => setPreviewError('The browser could not play this source file.')}
                      />
                    )}
                    {originalUrl && !previewLoaded && !previewError && (
                      <p className={styles.previewNote} role="status">
                        {t('Loading video preview...')}
                      </p>
                    )}
                    {previewError && <p className={styles.previewNote}>{t(previewError)}</p>}
                    {previewRateUnsupported && (
                      <p className={styles.previewNote} role="status">
                        {t('The browser cannot preview the selected playback speed.')}
                      </p>
                    )}
                    <p className={styles.previewNote}>
                      {t('Preview uses browser playbackRate. Pitch correction follows browser support.')}
                    </p>
                    <p className={styles.previewNote}>
                      {keepAudio ? t('Audio is on in the preview.') : t('Audio is muted to match the selected export setting.')}
                    </p>
                  </section>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleRun}>
                      {t('Change speed to {speed}x', { speed: num(speed) })}
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
