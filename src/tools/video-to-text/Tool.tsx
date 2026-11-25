import { useState, useId, useRef, useEffect } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { downloadBlob } from '../../lib/download';
import {
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
  toPlainText,
  toTimestampedText,
  WhisperTranscriptionJob,
  type ProgressState,
  type WhisperModel,
  type WhisperTask,
  type WhisperChunk,
} from '../_whisper';
import styles from './Tool.module.css';
import { useI18n } from '../../lib/i18n';

export default function VideoToTextTool() {
  const { t } = useI18n();
  const meta = getToolMeta('video-to-text');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [model, setModel] = useState<WhisperModel>('onnx-community/whisper-tiny');
  const [language, setLanguage] = useState<string>('');
  const [task, setTask] = useState<WhisperTask>('transcribe');

  const [isRunning, setIsRunning] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState>({
    phase: 'idle',
    ratio: 0,
    label: '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [chunks, setChunks] = useState<WhisperChunk[] | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [showTimestamps, setShowTimestamps] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const activeJobRef = useRef<WhisperTranscriptionJob | null>(null);
  const metadataRequestRef = useRef(0);

  useEffect(
    () => () => {
      metadataRequestRef.current++;
      activeJobRef.current?.abort();
      activeJobRef.current = null;
    },
    [],
  );

  const modelId = useId();
  const languageId = useId();
  const taskId = useId();
  const timestampToggleId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    setFile(selected);
    setMetaError(null);
    setErrorMessage(null);
    setVideoMeta(null);
    setChunks(null);
    setTranscript('');
    setShowTimestamps(false);

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId === metadataRequestRef.current) setVideoMeta(vMeta);
    } catch {
      // Audio-only files or videos without standard container metadata
    }
  };

  const handleReset = () => {
    metadataRequestRef.current++;
    if (activeJobRef.current) {
      activeJobRef.current.abort();
      activeJobRef.current = null;
    }
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setErrorMessage(null);
    setIsRunning(false);
    setChunks(null);
    setTranscript('');
    setShowTimestamps(false);
    setProgressState({ phase: 'idle', ratio: 0, label: '' });
  };

  const handleTranscribe = async () => {
    if (!file) return;

    setIsRunning(true);
    setErrorMessage(null);
    setChunks(null);
    setTranscript('');

    const job = new WhisperTranscriptionJob();
    activeJobRef.current = job;

    try {
      const result = await job.run(file, {
        model,
        language: language || undefined,
        task,
        videoDuration: videoMeta?.duration,
        onProgress: (state) => {
          if (activeJobRef.current === job) setProgressState(state);
        },
      });

      if (activeJobRef.current !== job) return;
      setChunks(result.chunks);
      setTranscript(toPlainText(result.chunks));
      setShowTimestamps(false);
    } catch (err: unknown) {
      if (activeJobRef.current === job) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (activeJobRef.current === job) {
        setIsRunning(false);
        activeJobRef.current = null;
      }
    }
  };

  const handleToggleTimestamps = (checked: boolean) => {
    setShowTimestamps(checked);
    if (!chunks) return;
    if (checked) {
      setTranscript(toTimestampedText(chunks));
    } else {
      setTranscript(toPlainText(chunks));
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const handleDownloadTxt = () => {
    if (!file || !transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const filename = replaceExt(file.name, '.txt');
    downloadBlob(blob, filename);
  };

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const charCount = transcript.length;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="video-to-text">
      {!file ? (
        <FileDrop
          accept="video/*,audio/*"
          label={t('Choose a video or audio file')}
          hint={t('Supports MP4, MOV, WebM, MKV, MP3, WAV, AAC, M4A and more.')}
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {errorMessage && <div className="error-banner">{t(errorMessage)}</div>}

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
          </div>

          {isRunning ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar
                value={progressState.phase === 'transcribing' ? 0.95 : progressState.ratio}
                label={t(progressState.label || 'Processing...')}
              />
            </div>
          ) : chunks ? (
            <div className={styles.transcriptCard}>
              <div className={styles.toolbar}>
                <label className="checkbox-label" htmlFor={timestampToggleId}>
                  <input
                    id={timestampToggleId}
                    type="checkbox"
                    checked={showTimestamps}
                    onChange={(e) => handleToggleTimestamps(e.target.checked)}
                  />
                  <span>{t('Show timestamps')}</span>
                </label>

                <div className={styles.wordCount}>
                  {t('{words} words • {characters} characters', { words: wordCount, characters: charCount })}
                </div>
              </div>

              <textarea
                className={styles.textarea}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={t('Transcript text...')}
              />

              <div className={styles.actionRow} style={{ justifyContent: 'space-between' }}>
                <div className={styles.actionRow}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Transcribe another file')}
                  </Button>
                </div>

                <div className={styles.actionRow}>
                  <Button variant="secondary" onClick={handleCopy}>
                    {copied ? `✓ ${t('Copied!')}` : t('Copy text')}
                  </Button>
                  <Button variant="primary" onClick={handleDownloadTxt}>
                    {t('Download .txt')}
                  </Button>
                </div>
              </div>
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
                  {t('Transcribe')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
