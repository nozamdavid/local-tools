import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button, Field } from '../../components/Controls';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { ToolPage } from '../../components/ToolPage';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { getToolMeta } from '../registry';
import { translate, useI18n } from '../../lib/i18n';
import { validateTrimRange, WAVEFORM_BIN_COUNT } from './audioTrim';
import { loadAudioAnalysis, trimAudioRange, type AudioAnalysis } from './processing';
import styles from './Tool.module.css';

type AnalysisStatus = 'idle' | 'loading' | 'ready' | 'error';
type PreviewStatus = 'checking' | 'ready' | 'unsupported';

function secondsFromInput(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function formatPreciseSeconds(value: number): string {
  return `${Number(value.toPrecision(10))} ${translate('seconds')}`;
}

function audioMime(file: File): string {
  if (file.type.startsWith('audio/')) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const known: Record<string, string> = {
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    weba: 'audio/webm',
    webm: 'audio/webm',
  };
  return known[extension ?? ''] ?? 'application/octet-stream';
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not read this audio file.';
}

export default function AudioTrimTool() {
  const { t } = useI18n();
  const meta = getToolMeta('audio-trim');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [startText, setStartText] = useState('0');
  const [endText, setEndText] = useState('0');
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('checking');
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const decodeAbortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const playbackIntentRef = useRef(0);
  const playbackTimerRef = useRef<number | null>(null);
  const startId = useId();
  const endId = useId();
  const rangeErrorId = useId();

  const job = useJob();
  const originalUrl = useObjectUrl(file);
  const start = secondsFromInput(startText);
  const end = secondsFromInput(endText);
  let rangeError: string | null = null;
  if (analysis) {
    try {
      validateTrimRange(start, end, analysis.duration);
    } catch (error) {
      rangeError = asErrorMessage(error);
    }
  }
  const rangeIsValid = analysis !== null && rangeError === null;
  const selectedDuration = rangeIsValid ? end - start : 0;

  const visiblePeaks = useMemo(() => {
    if (!analysis) return [];
    const barCount = 160;
    const values: number[] = [];
    for (let index = 0; index < barCount; index++) {
      const first = Math.floor((index / barCount) * WAVEFORM_BIN_COUNT);
      const afterLast = Math.max(first + 1, Math.floor(((index + 1) / barCount) * WAVEFORM_BIN_COUNT));
      let peak = 0;
      for (let bin = first; bin < afterLast; bin++) peak = Math.max(peak, analysis.peaks[bin] ?? 0);
      values.push(peak);
    }
    return values;
  }, [analysis]);

  const cancelPlayback = () => {
    playbackIntentRef.current++;
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (Number.isFinite(audio.duration)) audio.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const releasePreviewSource = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };

  const stopCurrentAnalysis = () => {
    generationRef.current++;
    decodeAbortRef.current?.abort();
    decodeAbortRef.current = null;
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    stopCurrentAnalysis();
    cancelPlayback();
    releasePreviewSource();
    job.reset();

    const selected = files[0];
    const generation = generationRef.current;
    const controller = new AbortController();
    decodeAbortRef.current = controller;
    setFile(selected);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisProgress(0);
    setAnalysisStatus('loading');
    setStartText('0');
    setEndText('0');
    setPreviewStatus('checking');
    setPreviewMessage(null);

    void loadAudioAnalysis(selected, controller.signal, (ratio) => {
      if (!controller.signal.aborted && generation === generationRef.current) setAnalysisProgress(ratio);
    })
      .then((nextAnalysis) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setAnalysis(nextAnalysis);
        setStartText('0');
        setEndText(String(nextAnalysis.duration));
        setAnalysisStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setAnalysisError(asErrorMessage(error));
        setAnalysisStatus('error');
      });
  };

  const handleReset = () => {
    stopCurrentAnalysis();
    cancelPlayback();
    releasePreviewSource();
    setFile(null);
    setAnalysis(null);
    setAnalysisStatus('idle');
    setAnalysisProgress(0);
    setAnalysisError(null);
    setStartText('0');
    setEndText('0');
    setPreviewStatus('checking');
    setPreviewMessage(null);
    job.reset();
  };

  useEffect(() => {
    if (!file || !originalUrl || !audioRef.current) return;
    const audio = audioRef.current;
    audio.pause();
    audio.src = originalUrl;
    audio.load();
    const support = audio.canPlayType(audioMime(file));
    if (support === '') {
      setPreviewStatus('unsupported');
      setPreviewMessage('This browser cannot preview this audio format. Trimming can still run locally.');
    } else {
      setPreviewStatus('checking');
      setPreviewMessage(null);
    }
  }, [file, originalUrl]);

  useEffect(
    () => () => {
      generationRef.current++;
      playbackIntentRef.current++;
      decodeAbortRef.current?.abort();
      if (playbackTimerRef.current !== null) window.clearTimeout(playbackTimerRef.current);
      audioRef.current?.pause();
      audioRef.current?.removeAttribute('src');
      audioRef.current?.load();
    },
    [],
  );

  const handlePlaySelection = async () => {
    const audio = audioRef.current;
    if (!audio || !rangeIsValid || previewStatus !== 'ready') return;
    if (isPlaying) {
      cancelPlayback();
      return;
    }

    cancelPlayback();
    audio.currentTime = start;
    const playGeneration = generationRef.current;
    const playIntent = playbackIntentRef.current;
    setIsPlaying(true);
    try {
      await audio.play();
      if (playIntent !== playbackIntentRef.current || playGeneration !== generationRef.current || audioRef.current !== audio) return;
      setIsPlaying(true);
      playbackTimerRef.current = window.setTimeout(
        () => {
          audio.pause();
          audio.currentTime = end;
          playbackTimerRef.current = null;
          setIsPlaying(false);
        },
        Math.max(0, end - start) * 1000,
      );
      setPreviewMessage(null);
    } catch {
      if (playIntent !== playbackIntentRef.current || playGeneration !== generationRef.current) return;
      setIsPlaying(false);
      setPreviewStatus('unsupported');
      setPreviewMessage('This browser could not play the selected audio. Trimming can still run locally.');
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !rangeIsValid || !isPlaying || audio.currentTime < end) return;
    cancelPlayback();
    audio.currentTime = end;
  };

  const handlePreviewReady = () => {
    if (!originalUrl || audioRef.current?.currentSrc !== originalUrl) return;
    setPreviewStatus('ready');
  };

  const handlePreviewError = () => {
    if (!originalUrl || audioRef.current?.currentSrc !== originalUrl) return;
    setPreviewStatus('unsupported');
    setPreviewMessage('This browser cannot preview this audio format. Trimming can still run locally.');
  };

  const handleTrim = () => {
    if (!file || !analysis || !rangeIsValid) return;
    cancelPlayback();
    const selectedFile = file;
    const selectedStart = start;
    const selectedEnd = end;
    const selectedDuration = analysis.duration;
    job.run((setProgress) => trimAudioRange(selectedFile, selectedStart, selectedEnd, selectedDuration, setProgress));
  };

  const outputFilename = file ? withSuffix(file.name, '-trimmed', 'wav') : '';
  const duration = analysis?.duration ?? 0;
  const clampedStart = Number.isFinite(start) ? Math.max(0, Math.min(duration, start)) : 0;
  const clampedEnd = Number.isFinite(end) ? Math.max(0, Math.min(duration, end)) : duration;
  const startPercent = duration > 0 ? (clampedStart / duration) * 100 : 0;
  const endPercent = duration > 0 ? (clampedEnd / duration) * 100 : 0;
  const step = duration > 0 ? Math.min(0.01, duration / 1000) : 0.01;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="audio-trim">
      {!file ? (
        <FileDrop
          accept="audio/*"
          label={t('Choose an audio file or drag it here')}
          hint={t('Trims to WAV locally. Files must be 64 MB or smaller and 10 minutes or shorter.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && (
            <div className="error-banner" role="alert">
              {t(job.error)}
            </div>
          )}
          {analysisError && (
            <div className="error-banner" role="alert">
              {t(analysisError)}
            </div>
          )}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={outputFilename}
              kind="audio"
              originalSize={file.size}
              beforePreview={originalUrl ? <audio controls src={originalUrl} style={{ width: '100%' }} /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <audio
                ref={audioRef}
                preload="metadata"
                onCanPlay={handlePreviewReady}
                onError={handlePreviewError}
                onTimeUpdate={handleTimeUpdate}
                className={styles.previewAudio}
              />

              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name:')} <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size:')} <strong>{formatBytes(file.size)}</strong>
                </span>
                {analysis && (
                  <span className="meta-chip">
                    {t('Duration:')} <strong>{formatDuration(analysis.duration)}</strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Trimming audio to WAV...')} />
              ) : analysisStatus === 'loading' ? (
                <div>
                  <ProgressBar value={analysisProgress} label={t('Reading audio and building waveform...')} />
                  <div className="action-buttons" style={{ marginTop: '1rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                  </div>
                </div>
              ) : analysis ? (
                <section className={styles.editor} aria-label={t('Audio trim selection')}>
                  <div className={styles.waveformHeading}>
                    <div>
                      <h2>{t('Waveform')}</h2>
                      <p>{t('Visual summary of the audio.')}</p>
                    </div>
                    <Button
                      variant="secondary"
                      icon={isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                      onClick={handlePlaySelection}
                      disabled={!rangeIsValid || previewStatus !== 'ready'}
                      aria-label={isPlaying ? t('Pause selected audio') : t('Play selected audio')}
                    >
                      {isPlaying ? t('Pause') : t('Play selection')}
                    </Button>
                  </div>

                  {visiblePeaks.length > 0 && (
                    <div
                      className={styles.waveform}
                      role="img"
                      aria-label={t('Waveform summary for {duration}', { duration: formatDuration(analysis.duration) })}
                    >
                      <div
                        className={styles.waveformSelection}
                        style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
                        aria-hidden="true"
                      />
                      {visiblePeaks.map((peak, index) => (
                        <span
                          className={styles.waveformBar}
                          key={index}
                          style={{ height: `${Math.max(3, Math.min(100, peak * 100))}%` }}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                  )}

                  {analysis.decoder === 'FFmpeg downsampled' && (
                    <p className={styles.decoderHint}>
                      {t('The waveform uses a local 8 kHz mono preview copy. The trim uses the full source audio.')}
                    </p>
                  )}
                  {previewMessage && (
                    <p className={styles.previewMessage} role="status">
                      {t(previewMessage)}
                    </p>
                  )}

                  <div className={styles.rangeControl}>
                    <div className={styles.rangeTrack} aria-hidden="true" />
                    <div
                      className={styles.rangeSelection}
                      style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
                      aria-hidden="true"
                    />
                    <input
                      type="range"
                      min={0}
                      max={analysis.duration}
                      step={step}
                      value={clampedStart}
                      className={styles.rangeInput}
                      style={{ zIndex: 3 }}
                      aria-label={t('Start time')}
                      aria-describedby={rangeError ? rangeErrorId : undefined}
                      aria-valuetext={t('{time} start', { time: formatPreciseSeconds(clampedStart) })}
                      aria-invalid={rangeError ? true : undefined}
                      onChange={(event) => {
                        cancelPlayback();
                        const next = Number(event.currentTarget.value);
                        const maxStart = Number.isFinite(end) ? end - step : analysis.duration - step;
                        setStartText(Number(Math.max(0, Math.min(next, maxStart)).toPrecision(10)).toString());
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={analysis.duration}
                      step={step}
                      value={clampedEnd}
                      className={styles.rangeInput}
                      style={{ zIndex: 2 }}
                      aria-label={t('End time')}
                      aria-describedby={rangeError ? rangeErrorId : undefined}
                      aria-valuetext={t('{time} end', { time: formatPreciseSeconds(clampedEnd) })}
                      aria-invalid={rangeError ? true : undefined}
                      onChange={(event) => {
                        cancelPlayback();
                        const next = Number(event.currentTarget.value);
                        const minEnd = Number.isFinite(start) ? start + step : step;
                        setEndText(Number(Math.max(minEnd, Math.min(next, analysis.duration)).toPrecision(10)).toString());
                      }}
                    />
                  </div>

                  <div className={styles.timeControls}>
                    <Field label={t('Start time')} htmlFor={startId}>
                      <input
                        id={startId}
                        type="number"
                        min={0}
                        max={analysis.duration}
                        step="any"
                        value={startText}
                        className={`input ${styles.timeInput}`}
                        aria-invalid={rangeError ? true : undefined}
                        aria-describedby={rangeError ? rangeErrorId : undefined}
                        onChange={(event) => {
                          cancelPlayback();
                          setStartText(event.currentTarget.value);
                        }}
                      />
                    </Field>
                    <Field label={t('End time')} htmlFor={endId}>
                      <input
                        id={endId}
                        type="number"
                        min={0}
                        max={analysis.duration}
                        step="any"
                        value={endText}
                        className={`input ${styles.timeInput}`}
                        aria-invalid={rangeError ? true : undefined}
                        aria-describedby={rangeError ? rangeErrorId : undefined}
                        onChange={(event) => {
                          cancelPlayback();
                          setEndText(event.currentTarget.value);
                        }}
                      />
                    </Field>
                  </div>

                  {rangeError ? (
                    <p id={rangeErrorId} className={styles.rangeError} role="alert">
                      {t(rangeError)}
                    </p>
                  ) : (
                    <p className={styles.selectedDuration}>
                      {t('Selected duration:')} <strong>{formatPreciseSeconds(selectedDuration)}</strong>
                    </p>
                  )}

                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleTrim} disabled={!rangeIsValid}>
                      {t('Trim audio')}
                    </Button>
                  </div>
                </section>
              ) : (
                <div className={styles.failedState}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Choose different file')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
