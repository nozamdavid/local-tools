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
import {
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
  toSrt,
  toVtt,
  WhisperTranscriptionJob,
  type ProgressState,
  type SubtitleCue,
  type WhisperModel,
  type WhisperTask,
} from '../_whisper';
import { burnSubtitlesIntoVideo, type SubtitleStyleOptions } from './burnSubtitles';
import { embedSoftSubtitles } from './embedSubtitles';
import styles from './Tool.module.css';

export default function SubtitlesTool() {
  const meta = getToolMeta('subtitles');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeTranscriptionJobRef = useRef<WhisperTranscriptionJob | null>(null);
  const originalUrl = useObjectUrl(file);

  const [vttBlobUrl, setVttBlobUrl] = useState<string | null>(null);

  const modelId = useId();
  const languageId = useId();
  const taskId = useId();
  const fontSizeId = useId();
  const fontColorId = useId();
  const bgBoxId = useId();
  const positionId = useId();

  // Keep VTT track refreshed whenever cues change
  useEffect(() => {
    if (!cues || cues.length === 0) {
      if (vttBlobUrl) {
        URL.revokeObjectURL(vttBlobUrl);
        setVttBlobUrl(null);
      }
      return;
    }

    const vttContent = toVtt(cues);
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

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);
    setVideoMeta(null);
    setCues(null);

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      // Audio file or standard container missing
    }
  };

  const handleReset = () => {
    if (activeTranscriptionJobRef.current) {
      activeTranscriptionJobRef.current.abort();
      activeTranscriptionJobRef.current = null;
    }
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);
    setCues(null);
    setIsTranscribing(false);
    setIsExporting(false);
  };

  const handleTranscribe = async () => {
    if (!file) return;

    setIsTranscribing(true);
    setTranscribeError(null);
    setExportError(null);
    setExportedResult(null);

    const job = new WhisperTranscriptionJob();
    activeTranscriptionJobRef.current = job;

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

      setCues(result.cues);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'Transcription cancelled') {
        setTranscribeError(msg);
      }
    } finally {
      setIsTranscribing(false);
      activeTranscriptionJobRef.current = null;
    }
  };

  const handleUpdateCue = (id: string, field: 'start' | 'end' | 'text', val: string) => {
    if (!cues) return;
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
    const lastCue = cues && cues.length > 0 ? cues[cues.length - 1] : null;
    const start = lastCue ? Math.round((lastCue.end + 0.1) * 100) / 100 : 0;
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
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, seconds);
      videoRef.current.play().catch(() => {});
    }
  };

  const handleDownloadSrt = () => {
    if (!file || !cues) return;
    const content = toSrt(cues);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, replaceExt(file.name, '.srt'));
  };

  const handleDownloadVtt = () => {
    if (!file || !cues) return;
    const content = toVtt(cues);
    const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
    downloadBlob(blob, replaceExt(file.name, '.vtt'));
  };

  const handleBurnIn = async () => {
    if (!file || !cues) return;
    setIsExporting(true);
    setExportError(null);
    setExportLabel('Rendering and burning subtitles into video...');
    setExportRatio(0.05);

    try {
      const style: SubtitleStyleOptions = {
        fontSize,
        color: fontColor,
        backgroundBox,
        position,
      };

      const burnedBlob = await burnSubtitlesIntoVideo(file, cues, style, videoMeta?.width || 1280, videoMeta?.height || 720, (ratio) => {
        setExportRatio(ratio);
      });

      setExportedResult({
        blob: burnedBlob,
        filename: withSuffix(file.name, '-subtitled-burned', 'mp4'),
      });
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleEmbedSoft = async () => {
    if (!file || !cues) return;
    setIsExporting(true);
    setExportError(null);
    setExportLabel('Embedding soft subtitles track into MP4...');
    setExportRatio(0.1);

    try {
      const softBlob = await embedSoftSubtitles(file, cues, (ratio) => {
        setExportRatio(ratio);
      });

      setExportedResult({
        blob: softBlob,
        filename: withSuffix(file.name, '-subtitled-soft', 'mp4'),
      });
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="subtitles">
      {!file ? (
        <FileDrop
          accept="video/*,audio/*"
          label="Choose a video or audio file"
          hint="Supports MP4, MOV, WebM, MKV and more. Transcribed with on-device AI."
          onFiles={handleFiles}
        />
      ) : (
        <div className={styles.container}>
          {metaError && <div className="error-banner">{metaError}</div>}
          {transcribeError && <div className="error-banner">{transcribeError}</div>}
          {exportError && <div className="error-banner">{exportError}</div>}

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
            {videoMeta && videoMeta.width > 0 && (
              <span className="meta-chip">
                Resolution:{' '}
                <strong>
                  {videoMeta.width}x{videoMeta.height}
                </strong>
              </span>
            )}
          </div>

          {isTranscribing ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar
                value={progressState.phase === 'transcribing' ? 0.95 : progressState.ratio}
                label={progressState.label || 'Transcribing...'}
              />
            </div>
          ) : isExporting ? (
            <div style={{ marginTop: '1rem' }}>
              <ProgressBar value={exportRatio} label={exportLabel || 'Processing video...'} />
            </div>
          ) : exportedResult ? (
            <ResultPanel
              blob={exportedResult.blob}
              filename={exportedResult.filename}
              kind="video"
              originalSize={file.size}
              beforePreview={originalUrl ? <video controls src={originalUrl} className="preview-media" playsInline /> : null}
              onReset={() => setExportedResult(null)}
            />
          ) : cues ? (
            <div className={styles.editorLayout}>
              {/* Video preview with live track */}
              {originalUrl && (
                <div className={styles.videoSection}>
                  <video ref={videoRef} controls playsInline src={originalUrl} className={styles.videoPreview}>
                    {vttBlobUrl && <track key={vttBlobUrl} kind="subtitles" src={vttBlobUrl} srcLang="en" label="Subtitles" default />}
                  </video>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Live preview: video displays cues updated in real time.
                  </span>
                </div>
              )}

              {/* Editable cue list */}
              <div className={styles.cuesSection}>
                <div className={styles.cuesHeader}>
                  <div className={styles.cuesTitle}>
                    Subtitles ({cues.length} {cues.length === 1 ? 'cue' : 'cues'})
                  </div>
                  <Button variant="secondary" onClick={handleAddCue}>
                    + Add Cue
                  </Button>
                </div>

                <div className={styles.cueList}>
                  {cues.map((cue, idx) => (
                    <div key={cue.id} className={styles.cueRow}>
                      <input
                        type="number"
                        step="0.1"
                        className={styles.timeInput}
                        value={cue.start}
                        onChange={(e) => handleUpdateCue(cue.id, 'start', e.target.value)}
                        title="Start time (seconds)"
                      />
                      <input
                        type="number"
                        step="0.1"
                        className={styles.timeInput}
                        value={cue.end}
                        onChange={(e) => handleUpdateCue(cue.id, 'end', e.target.value)}
                        title="End time (seconds)"
                      />
                      <input
                        type="text"
                        className={styles.textInput}
                        value={cue.text}
                        onChange={(e) => handleUpdateCue(cue.id, 'text', e.target.value)}
                        placeholder={`Cue #${idx + 1}`}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => handleSeekVideo(cue.start)}
                        title="Seek video to cue start"
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.deleteBtn}`}
                        onClick={() => handleDeleteCue(cue.id)}
                        title="Delete cue"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Burn-in Style Options */}
              <div className={styles.stylesCard}>
                <div className={styles.stylesTitle}>Burn-in Appearance Options</div>
                <div className={styles.stylesGrid}>
                  <Field label="Font size">
                    <Select
                      id={fontSizeId}
                      value={String(fontSize)}
                      onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                      options={[
                        { value: '20', label: 'Small (20px)' },
                        { value: '28', label: 'Medium (28px - recommended)' },
                        { value: '36', label: 'Large (36px)' },
                        { value: '48', label: 'Extra Large (48px)' },
                      ]}
                    />
                  </Field>

                  <Field label="Subtitle color">
                    <Select
                      id={fontColorId}
                      value={fontColor}
                      onChange={(e) => setFontColor(e.target.value)}
                      options={[
                        { value: '#ffffff', label: 'White' },
                        { value: '#ffe600', label: 'Yellow' },
                        { value: '#00ffff', label: 'Cyan' },
                        { value: '#00ff88', label: 'Green' },
                      ]}
                    />
                  </Field>

                  <Field label="Position">
                    <Select
                      id={positionId}
                      value={position}
                      onChange={(e) => setPosition(e.target.value as 'bottom' | 'top')}
                      options={[
                        { value: 'bottom', label: 'Bottom' },
                        { value: 'top', label: 'Top' },
                      ]}
                    />
                  </Field>

                  <div className="field">
                    <label className="checkbox-label" htmlFor={bgBoxId}>
                      <input id={bgBoxId} type="checkbox" checked={backgroundBox} onChange={(e) => setBackgroundBox(e.target.checked)} />
                      <span>Background box</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Action outputs */}
              <div className={styles.actionSection}>
                <div className={styles.buttonGroup} style={{ justifyContent: 'space-between' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    Start over
                  </Button>

                  <div className={styles.buttonGroup}>
                    <Button variant="secondary" onClick={handleDownloadSrt}>
                      Download .srt
                    </Button>
                    <Button variant="secondary" onClick={handleDownloadVtt}>
                      Download .vtt
                    </Button>
                    <Button variant="secondary" onClick={handleEmbedSoft}>
                      Embed soft subtitles
                    </Button>
                    <Button variant="primary" onClick={handleBurnIn}>
                      Burn into video
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <div className={styles.optionsGrid}>
                <Field label="Whisper Model" hint="Tiny runs fastest with low memory; Small provides higher accuracy.">
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

                <Field label="Language" hint="Select spoken language or let Whisper detect automatically.">
                  <Select id={languageId} value={language} onChange={(e) => setLanguage(e.target.value)} options={WHISPER_LANGUAGES} />
                </Field>

                <Field label="Task" hint="Transcribe original audio or translate directly into English.">
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
                  Generate Subtitles
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
