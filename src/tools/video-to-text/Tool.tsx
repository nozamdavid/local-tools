import { useState, useId, useRef } from 'react';
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

export default function VideoToTextTool() {
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

  const modelId = useId();
  const languageId = useId();
  const taskId = useId();
  const timestampToggleId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setErrorMessage(null);
    setVideoMeta(null);
    setChunks(null);
    setTranscript('');
    setShowTimestamps(false);

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      // Audio-only files or videos without standard container metadata
    }
  };

  const handleReset = () => {
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
          setProgressState(state);
        },
      });

      setChunks(result.chunks);
      setTranscript(toPlainText(result.chunks));
      setShowTimestamps(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'Transcription cancelled') {
        setErrorMessage(msg);
      }
    } finally {
      setIsRunning(false);
      activeJobRef.current = null;
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
          label="Choose a video or audio file"
          hint="Supports MP4, MOV, WebM, MKV, MP3, WAV, AAC, M4A and more. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {metaError && <div className="error-banner">{metaError}</div>}
          {errorMessage && <div className="error-banner">{errorMessage}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              File: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>{formatBytes(file.size)}</strong>
            </span>
            {videoMeta && videoMeta.duration > 0 && (
              <span className="meta-chip">
                Duration: <strong>{formatDuration(videoMeta.duration)}</strong>
              </span>
            )}
          </div>

          {isRunning ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar
                value={
                  progressState.phase === 'transcribing'
                    ? 0.95
                    : progressState.ratio
                }
                label={progressState.label || 'Processing...'}
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
                  <span>Show timestamps</span>
                </label>

                <div className={styles.wordCount}>
                  {wordCount} words &bull; {charCount} characters
                </div>
              </div>

              <textarea
                className={styles.textarea}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Transcript text..."
              />

              <div className={styles.actionRow} style={{ justifyContent: 'space-between' }}>
                <div className={styles.actionRow}>
                  <Button variant="secondary" onClick={handleReset}>
                    Transcribe another file
                  </Button>
                </div>

                <div className={styles.actionRow}>
                  <Button variant="secondary" onClick={handleCopy}>
                    {copied ? '✓ Copied!' : 'Copy text'}
                  </Button>
                  <Button variant="primary" onClick={handleDownloadTxt}>
                    Download .txt
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <div className={styles.optionsGrid}>
                <Field
                  label="Whisper Model"
                  hint="Tiny runs fastest with low memory; Small provides higher accuracy."
                >
                  <Select
                    id={modelId}
                    value={model}
                    onChange={(e) => setModel(e.target.value as WhisperModel)}
                    options={WHISPER_MODELS.map((m) => ({
                      value: m.value,
                      label: m.label,
                    }))}
                  />
                </Field>

                <Field
                  label="Language"
                  hint="Select spoken language or let Whisper detect automatically."
                >
                  <Select
                    id={languageId}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    options={WHISPER_LANGUAGES}
                  />
                </Field>

                <Field
                  label="Task"
                  hint="Transcribe original audio or translate directly into English."
                >
                  <Select
                    id={taskId}
                    value={task}
                    onChange={(e) => setTask(e.target.value as WhisperTask)}
                    options={[
                      { value: 'transcribe', label: 'Transcribe (same language)' },
                      { value: 'translate', label: 'Translate to English' },
                    ]}
                  />
                </Field>
              </div>

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Choose different file
                </Button>
                <Button variant="primary" onClick={handleTranscribe}>
                  Transcribe
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
