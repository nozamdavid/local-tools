import { useState, useId, useRef, useEffect } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt, withSuffix } from '../../lib/format';
import { downloadBlob } from '../../lib/download';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import {
  MAX_SUBTITLE_CUE_TEXT_CHARS,
  MAX_SUBTITLE_CUES,
  MAX_SUBTITLE_FILE_BYTES,
  MAX_SUBTITLE_TIME_SECONDS,
  parseSubtitles,
  shiftSubtitleCues,
  toSrt,
  toVtt,
  validateSubtitleCues,
  type ParsedSubtitles,
  type SubtitleFormat,
} from '../_whisper/formats';
import {
  WHISPER_LANGUAGES,
  WHISPER_MODELS,
  type ProgressState,
  type SubtitleCue,
  type WhisperModel,
  type WhisperTask,
} from '../_whisper/types';
import type { WhisperTranscriptionJob } from '../_whisper/whisperClient';
import type { SubtitleStyleOptions } from './burnSubtitles';
import styles from './Tool.module.css';

function CueTimeInput({
  value,
  onCommit,
  label,
  className,
}: {
  value: number;
  onCommit: (value: string) => void;
  label: string;
  className: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      step="0.1"
      className={className}
      value={draft ?? value}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export default function SubtitlesTool() {
  const { t } = useI18n();
  const meta = getToolMeta('subtitles');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [parsedSource, setParsedSource] = useState<ParsedSubtitles | null>(null);
  const [isParsingSidecar, setIsParsingSidecar] = useState(false);

  const [model, setModel] = useState<WhisperModel>('onnx-community/whisper-tiny');
  const [language, setLanguage] = useState<string>('');
  const [task, setTask] = useState<WhisperTask>('transcribe');

  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState>({
    phase: 'idle',
    ratio: 0,
    label: '',
  });
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // Style options for burn-in
  const [fontSize, setFontSize] = useState<number>(28);
  const [fontColor, setFontColor] = useState<string>('#ffffff');
  const [backgroundBox, setBackgroundBox] = useState<boolean>(true);
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');

  // Video processing export job states
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportRatio, setExportRatio] = useState<number>(0);
  const [exportLabel, setExportLabel] = useState<string>('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedResult, setExportedResult] = useState<{
    blob: Blob;
    filename: string;
  } | null>(null);
  const [shiftSeconds, setShiftSeconds] = useState('0');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTranscriptionJobRef = useRef<WhisperTranscriptionJob | null>(null);
  const activeSessionRef = useRef(0);
  const originalUrl = useObjectUrl(file);

  const [vttBlobUrl, setVttBlobUrl] = useState<string | null>(null);

  const modelId = useId();
  const languageId = useId();
  const taskId = useId();
  const fontSizeId = useId();
  const fontColorId = useId();
  const bgBoxId = useId();
  const positionId = useId();
  const shiftId = useId();

  const isSidecar = Boolean(file && /\.(srt|vtt)$/i.test(file.name));
  const isVideoSource = Boolean(
    file && !isSidecar && (file.type.startsWith('video/') || (videoMeta && videoMeta.width > 0 && videoMeta.height > 0)),
  );
  const isAudioSource = Boolean(file && !isSidecar && file.type.startsWith('audio/'));

  // Keep VTT track refreshed whenever cues change
  useEffect(() => {
    if (!cues || cues.length === 0) {
      // The previous effect's cleanup owns and revokes its URL.
      setVttBlobUrl(null);
      return;
    }

    let vttContent: string;
    try {
      vttContent = toVtt(cues);
    } catch {
      setVttBlobUrl(null);
      return;
    }
    const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setVttBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [cues]);

  // Ensure track is showing when track element is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const showTrack = () => {
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'showing';
        }
      }
    };

    video.addEventListener('loadedmetadata', showTrack);
    showTrack();
    return () => {
      video.removeEventListener('loadedmetadata', showTrack);
    };
  }, [vttBlobUrl]);

  useEffect(
    () => () => {
      activeSessionRef.current++;
      activeTranscriptionJobRef.current?.abort();
    },
    [],
  );

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const session = ++activeSessionRef.current;
    activeTranscriptionJobRef.current?.abort();
    activeTranscriptionJobRef.current = null;
    setFile(selected);
    setMetaError(null);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);
    setVideoMeta(null);
    setCues(null);
    setParsedSource(null);
    setShiftSeconds('0');
    setIsTranscribing(false);
    setIsExporting(false);
    setIsParsingSidecar(false);
    setProgressState({ phase: 'idle', ratio: 0, label: '' });

    const extension = selected.name.split('.').pop()?.toLowerCase();
    if (extension === 'srt' || extension === 'vtt') {
      setIsParsingSidecar(true);
      try {
        if (selected.size > MAX_SUBTITLE_FILE_BYTES) {
          throw new Error(t('Subtitle file is too large (maximum {size} MB).', { size: Math.round(MAX_SUBTITLE_FILE_BYTES / 1_000_000) }));
        }
        const content = await selected.text();
        if (session !== activeSessionRef.current) return;
        const parsed = parseSubtitles(content, extension as SubtitleFormat);
        setParsedSource(parsed);
        setCues(parsed.cues);
      } catch (err: unknown) {
        if (session === activeSessionRef.current) setMetaError(err instanceof Error ? err.message : String(err));
      } finally {
        if (session === activeSessionRef.current) setIsParsingSidecar(false);
      }
      return;
    }

    try {
      const vMeta = await getVideoMeta(selected);
      if (session === activeSessionRef.current) setVideoMeta(vMeta);
    } catch {
      // Audio file or standard container missing
    }
  };

  const handleReset = () => {
    activeSessionRef.current++;
    if (activeTranscriptionJobRef.current) {
      activeTranscriptionJobRef.current.abort();
      activeTranscriptionJobRef.current = null;
    }
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setParsedSource(null);
    setIsParsingSidecar(false);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);
    setCues(null);
    setIsTranscribing(false);
    setIsExporting(false);
    setShiftSeconds('0');
    setProgressState({ phase: 'idle', ratio: 0, label: '' });
  };

  const handleTranscribe = async () => {
    if (!file) return;

    const session = activeSessionRef.current;
    setIsTranscribing(true);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);

    let job: WhisperTranscriptionJob | null = null;
    try {
      const { WhisperTranscriptionJob } = await import('../_whisper/whisperClient');
      if (session !== activeSessionRef.current) return;
      job = new WhisperTranscriptionJob();
      activeTranscriptionJobRef.current = job;
      const result = await job.run(file, {
        model,
        language: language || undefined,
        task,
        videoDuration: videoMeta?.duration,
        onProgress: (state) => {
          if (session === activeSessionRef.current) setProgressState(state);
        },
      });

      if (session === activeSessionRef.current) setCues(result.cues);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (session === activeSessionRef.current && msg !== 'Transcription cancelled') {
        setTranscribeError(msg);
      }
    } finally {
      if (session === activeSessionRef.current) setIsTranscribing(false);
      if (activeTranscriptionJobRef.current === job) activeTranscriptionJobRef.current = null;
    }
  };

  const handleUpdateCue = (id: string, field: 'start' | 'end' | 'text', val: string) => {
    if (!cues) return;
    setExportError(null);
    setCues((prev) => {
      if (!prev) return prev;
      return prev.map((c) => {
        if (c.id !== id) return c;
        if (field === 'text') {
          return { ...c, text: val };
        }
        const num = parseFloat(val);
        return { ...c, [field]: Number.isFinite(num) ? num : c[field] };
      });
    });
  };

  const handleDeleteCue = (id: string) => {
    if (!cues) return;
    setCues((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
  };

  const handleAddCue = () => {
    if (cues && cues.length >= MAX_SUBTITLE_CUES) {
      setExportError(t('Subtitle files may contain at most {count} cues.', { count: MAX_SUBTITLE_CUES.toLocaleString() }));
      return;
    }
    const lastCue = cues && cues.length > 0 ? cues[cues.length - 1] : null;
    const start = lastCue ? Math.round((lastCue.end + 0.1) * 100) / 100 : 0;
    if (start + 3 > MAX_SUBTITLE_TIME_SECONDS) {
      setExportError('Cannot add a cue after the seven-day timing limit.');
      return;
    }
    const end = Math.round((start + 3) * 100) / 100;
    const newCue: SubtitleCue = {
      id: `cue-${Date.now()}-${Math.random()}`,
      start,
      end,
      text: 'New subtitle text',
    };
    setCues((prev) => (prev ? [...prev, newCue] : [newCue]));
  };

  const handleSeekVideo = (seconds: number) => {
    const media = videoRef.current ?? audioRef.current;
    if (media) {
      media.currentTime = Math.max(0, seconds);
      media.play().catch(() => {});
    }
  };

  const handleDownloadSrt = () => {
    if (!file || !cues) return;
    try {
      const content = toSrt(cues);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, replaceExt(file.name, '.srt'));
      setExportError(null);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadVtt = () => {
    if (!file || !cues) return;
    try {
      const content = toVtt(cues);
      const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
      downloadBlob(blob, replaceExt(file.name, '.vtt'));
      setExportError(null);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleShift = () => {
    if (!cues) return;
    const shift = Number(shiftSeconds.trim());
    if (!shiftSeconds.trim() || !Number.isFinite(shift)) {
      setExportError('Enter a finite shift in seconds.');
      return;
    }
    try {
      setCues(shiftSubtitleCues(cues, shift));
      setExportError(null);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBurnIn = async () => {
    if (!file || !cues || !isVideoSource) return;
    const session = activeSessionRef.current;
    setIsExporting(true);
    setExportError(null);
    setExportLabel(t('Rendering and burning subtitles into video...'));
    setExportRatio(0.05);

    try {
      validateSubtitleCues(cues);
      const { burnSubtitlesIntoVideo } = await import('./burnSubtitles');
      if (session !== activeSessionRef.current) return;
      const style: SubtitleStyleOptions = {
        fontSize,
        color: fontColor,
        backgroundBox,
        position,
      };

      const burnedBlob = await burnSubtitlesIntoVideo(file, cues, style, videoMeta?.width || 1280, videoMeta?.height || 720, (ratio) => {
        if (session === activeSessionRef.current) setExportRatio(ratio);
      });

      if (session === activeSessionRef.current) {
        setExportedResult({
          blob: burnedBlob,
          filename: withSuffix(file.name, '-subtitled-burned', 'mp4'),
        });
      }
    } catch (err: unknown) {
      if (session === activeSessionRef.current) setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (session === activeSessionRef.current) setIsExporting(false);
    }
  };

  const handleEmbedSoft = async () => {
    if (!file || !cues || !isVideoSource) return;
    const session = activeSessionRef.current;
    setIsExporting(true);
    setExportError(null);
    setExportLabel(t('Embedding soft subtitles track into MP4...'));
    setExportRatio(0.1);

    try {
      const { embedSoftSubtitles } = await import('./embedSubtitles');
      if (session !== activeSessionRef.current) return;
      const softBlob = await embedSoftSubtitles(file, cues, (ratio) => {
        if (session === activeSessionRef.current) setExportRatio(ratio);
      });

      if (session === activeSessionRef.current) {
        setExportedResult({
          blob: softBlob,
          filename: withSuffix(file.name, '-subtitled-soft', 'mp4'),
        });
      }
    } catch (err: unknown) {
      if (session === activeSessionRef.current) setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (session === activeSessionRef.current) setIsExporting(false);
    }
  };

  const importedMetadataNotices = parsedSource
    ? [
        parsedSource.metadata.ignoredBlocks.length > 0 || parsedSource.metadata.headerMetadata
          ? t('{blocks} are not retained; cue IDs, text, and timing remain.', {
              blocks: [
                ...parsedSource.metadata.ignoredBlocks.map((block) => `${block} blocks`),
                ...(parsedSource.metadata.headerMetadata ? ['header metadata'] : []),
              ].join(' and '),
            })
          : null,
        parsedSource.metadata.hasCueSettings ? t('WebVTT cue settings are preserved in VTT exports; SRT has no equivalent.') : null,
        parsedSource.metadata.hasCueMarkup ? t('WebVTT cue markup is treated as plain text; its formatting is not retained.') : null,
      ].filter((notice): notice is string => notice !== null)
    : [];

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="subtitles">
      {!file ? (
        <FileDrop
          accept="video/*,audio/*,.srt,.vtt"
          label={t('Choose a video, audio, or subtitle file')}
          hint={t('Transcribe video or audio on this device, or open an SRT or VTT file to edit it.')}
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {metaError && (
            <div className="error-banner" role="alert">
              {t(metaError)}
            </div>
          )}
          {transcribeError && (
            <div className="error-banner" role="alert">
              {t(transcribeError)}
            </div>
          )}
          {exportError && (
            <div className="error-banner" role="alert">
              {t(exportError)}
            </div>
          )}

          <div className="meta-chips">
            <span className="meta-chip">
              {t('File:')} <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              {t('Size:')} <strong>{formatBytes(file.size)}</strong>
            </span>
            {videoMeta && videoMeta.duration > 0 && (
              <span className="meta-chip">
                {t('Duration:')} <strong>{formatDuration(videoMeta.duration)}</strong>
              </span>
            )}
            {videoMeta && videoMeta.width > 0 && (
              <span className="meta-chip">
                {t('Resolution:')}{' '}
                <strong>
                  {videoMeta.width}x{videoMeta.height}
                </strong>
              </span>
            )}
          </div>

          {isParsingSidecar ? (
            <div style={{ marginTop: '1rem' }}>{t('Reading subtitle cues locally…')}</div>
          ) : isTranscribing ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar
                value={progressState.phase === 'transcribing' ? 0.95 : progressState.ratio}
                label={t(progressState.label || 'Transcribing...')}
              />
              <Button variant="secondary" onClick={handleReset}>
                {t('Cancel transcription')}
              </Button>
            </div>
          ) : isExporting ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar value={exportRatio} label={exportLabel || t('Processing video...')} />
            </div>
          ) : exportedResult ? (
            <ResultPanel
              blob={exportedResult.blob}
              filename={exportedResult.filename}
              kind="video"
              originalSize={file.size}
              beforePreview={
                originalUrl && isVideoSource ? <video controls src={originalUrl} className="preview-media" playsInline /> : null
              }
              onReset={() => setExportedResult(null)}
            />
          ) : cues ? (
            <div className={styles.editorLayout}>
              {/* Video preview with live track */}
              {originalUrl && isVideoSource && (
                <div className={styles.videoSection}>
                  <video ref={videoRef} controls playsInline src={originalUrl} className={styles.videoPreview}>
                    {vttBlobUrl && <track key={vttBlobUrl} kind="subtitles" src={vttBlobUrl} srcLang="en" label={t('Subtitles')} default />}
                  </video>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {t('Live preview: video displays cues updated in real time.')}
                  </span>
                </div>
              )}
              {originalUrl && isAudioSource && (
                <div className={styles.videoSection}>
                  <audio ref={audioRef} controls src={originalUrl} />
                </div>
              )}

              {importedMetadataNotices.map((notice) => (
                <div key={notice} className={styles.noticeBanner}>
                  {notice}
                </div>
              ))}

              {/* Editable cue list */}
              <div className={styles.cuesSection}>
                <div className={styles.cuesHeader}>
                  <div className={styles.cuesTitle}>
                    {t('Subtitles ({count} {cueLabel})', { count: cues.length, cueLabel: cues.length === 1 ? t('cue') : t('cues') })}
                  </div>
                  <Button variant="secondary" onClick={handleAddCue} disabled={cues.length >= MAX_SUBTITLE_CUES}>
                    + {t('Add Cue')}
                  </Button>
                </div>

                <div className={styles.cueList}>
                  {cues.map((cue, idx) => (
                    <div key={cue.id} className={`${styles.cueRow} ${isVideoSource || isAudioSource ? styles.cueRowWithMedia : ''}`}>
                      <CueTimeInput
                        className={`input ${styles.timeInput} ${styles.cueStart}`}
                        value={cue.start}
                        onCommit={(value) => handleUpdateCue(cue.id, 'start', value)}
                        label={t('Start time for cue {number} in seconds', { number: idx + 1 })}
                      />
                      <CueTimeInput
                        className={`input ${styles.timeInput} ${styles.cueEnd}`}
                        value={cue.end}
                        onCommit={(value) => handleUpdateCue(cue.id, 'end', value)}
                        label={t('End time for cue {number} in seconds', { number: idx + 1 })}
                      />
                      <textarea
                        className={`textarea ${styles.textInput} ${styles.cueText}`}
                        value={cue.text}
                        rows={2}
                        maxLength={MAX_SUBTITLE_CUE_TEXT_CHARS}
                        onChange={(e) => handleUpdateCue(cue.id, 'text', e.target.value)}
                        placeholder={t('Cue #{number}', { number: idx + 1 })}
                        aria-label={t('Subtitle text for cue {number}', { number: idx + 1 })}
                      />
                      {(isVideoSource || isAudioSource) && (
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.cueSeek}`}
                          onClick={() => handleSeekVideo(cue.start)}
                          aria-label={t('Seek media to start of cue {number}', { number: idx + 1 })}
                        >
                          ▶
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.deleteBtn} ${styles.cueDelete}`}
                        onClick={() => handleDeleteCue(cue.id)}
                        aria-label={t('Delete cue {number}', { number: idx + 1 })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.shiftSection}>
                <div>
                  <div className={styles.stylesTitle}>{t('Shift all cues')}</div>
                  <p className={styles.shiftHint}>
                    {t(
                      'Positive seconds delay subtitles; negative seconds move them earlier. A shift that moves any cue before zero is rejected.',
                    )}
                  </p>
                </div>
                <Field label={t('Shift in seconds')}>
                  <input
                    id={shiftId}
                    className={`input ${styles.timeInput}`}
                    type="number"
                    step="0.1"
                    value={shiftSeconds}
                    onChange={(e) => setShiftSeconds(e.target.value)}
                  />
                </Field>
                <Button variant="secondary" onClick={handleShift}>
                  {t('Apply shift')}
                </Button>
              </div>

              {/* Burn-in Style Options */}
              {isVideoSource && (
                <details className="tool-options">
                  <summary>{t('Burn-in appearance')}</summary>
                  <div className="tool-options-body">
                    <Field label={t('Font size')}>
                      <Select
                        id={fontSizeId}
                        value={String(fontSize)}
                        onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                        options={[
                          { value: '20', label: t('Small (20px)') },
                          { value: '28', label: t('Medium (28px - recommended)') },
                          { value: '36', label: t('Large (36px)') },
                          { value: '48', label: t('Extra Large (48px)') },
                        ]}
                      />
                    </Field>

                    <Field label={t('Subtitle color')}>
                      <Select
                        id={fontColorId}
                        value={fontColor}
                        onChange={(e) => setFontColor(e.target.value)}
                        options={[
                          { value: '#ffffff', label: t('White') },
                          { value: '#ffe600', label: t('Yellow') },
                          { value: '#00ffff', label: t('Cyan') },
                          { value: '#00ff88', label: t('Green') },
                        ]}
                      />
                    </Field>

                    <Field label={t('Position')}>
                      <Select
                        id={positionId}
                        value={position}
                        onChange={(e) => setPosition(e.target.value as 'bottom' | 'top')}
                        options={[
                          { value: 'bottom', label: t('Bottom') },
                          { value: 'top', label: t('Top') },
                        ]}
                      />
                    </Field>

                    <div className="field">
                      <label className="checkbox-label" htmlFor={bgBoxId}>
                        <input id={bgBoxId} type="checkbox" checked={backgroundBox} onChange={(e) => setBackgroundBox(e.target.checked)} />
                        <span>{t('Background box')}</span>
                      </label>
                    </div>
                  </div>
                </details>
              )}

              {/* Action outputs */}
              <div className={styles.actionSection}>
                <div className={styles.buttonGroup} style={{ justifyContent: 'space-between' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Start over')}
                  </Button>

                  <div className={styles.buttonGroup}>
                    <Button variant="secondary" onClick={handleDownloadSrt}>
                      {t('Download .srt')}
                    </Button>
                    <Button variant="secondary" onClick={handleDownloadVtt}>
                      {t('Download .vtt')}
                    </Button>
                    {isVideoSource && (
                      <>
                        <Button variant="secondary" onClick={handleEmbedSoft}>
                          {t('Embed soft subtitles')}
                        </Button>
                        <Button variant="primary" onClick={handleBurnIn}>
                          {t('Burn into video')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : isSidecar ? (
            <div className={styles.sidecarErrorState} role="alert">
              <p>{t('This subtitle file could not be opened. Choose another file to continue.')}</p>
              <Button variant="secondary" onClick={handleReset}>
                {t('Choose different file')}
              </Button>
            </div>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <div className={styles.optionsGrid}>
                <Field label={t('Whisper Model')} hint={t('Tiny runs fastest with low memory; Small provides higher accuracy.')}>
                  <Select
                    id={modelId}
                    value={model}
                    onChange={(e) => setModel(e.target.value as WhisperModel)}
                    options={WHISPER_MODELS.map((m) => ({
                      value: m.value,
                      label: t(m.label),
                    }))}
                  />
                </Field>

                <Field label={t('Language')} hint={t('Select spoken language or let Whisper detect automatically.')}>
                  <Select
                    id={languageId}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    options={WHISPER_LANGUAGES.map((option) => ({ ...option, label: t(option.label) }))}
                  />
                </Field>

                <Field label={t('Task')} hint={t('Transcribe original audio or translate directly into English.')}>
                  <Select
                    id={taskId}
                    value={task}
                    onChange={(e) => setTask(e.target.value as WhisperTask)}
                    options={[
                      { value: 'transcribe', label: t('Transcribe (same language)') },
                      { value: 'translate', label: t('Translate to English') },
                    ]}
                  />
                </Field>
              </div>

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Choose different file')}
                </Button>
                <Button variant="primary" onClick={handleTranscribe}>
                  {t('Generate Subtitles')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
