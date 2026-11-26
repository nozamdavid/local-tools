import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Crop,
  Download,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Gauge,
  Music2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button, Field, Select } from '../../components/Controls';
import { CopyImageButton } from '../../components/CopyImageButton';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { downloadBlob } from '../../lib/download';
import { describeError } from '../../lib/errors';
import { formatDuration, formatNumber, withSuffix } from '../../lib/format';
import { matchesAccept } from '../../lib/handoff';
import { useI18n } from '../../lib/i18n';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { exportVideoEdit, type VideoEdit } from './engine';
import { buildTimeline, locateTime, readAudioDuration, readFrameRate } from './timeline';
import { useDraft, type Draft } from './useDraft';
import { usePreview } from './usePreview';
import { CropFrame } from './CropFrame';
import { ClipThumbnails, useClipThumbnails } from './ClipThumbnails';
import styles from './Tool.module.css';

const videoAccept = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.ogv';
const audioAccept = 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aiff,.aif,.weba';
const ratios = ['Free crop', '16:9', '9:16', '1:1', '4:5'] as const;
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const initial: Draft = {
  edit: {
    segments: [],
    speed: 1,
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    audioOffset: 0,
    audioVolume: 1,
  },
  trimBounds: [],
  soundtrack: null,
  soundtrackDuration: 0,
  format: 'mp4',
};
const tools = [
  { id: 'cut', label: 'Cut', Icon: Scissors },
  { id: 'crop', label: 'Crop', Icon: Crop },
  { id: 'transform', label: 'Transform', Icon: RotateCw },
  { id: 'speed', label: 'Speed', Icon: Gauge },
  { id: 'audio', label: 'Audio', Icon: AudioLines },
] as const;

type NumberFieldProps = { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void };
type History = { past: Draft[]; present: Draft; future: Draft[] };
type Source = { file: File; sample: boolean };
type Job = { progress: number } | { blob: Blob; filename: string };
type Pane = (typeof tools)[number]['id'];

function NumberField({ label, value, min, max, step = 0.001, onChange }: NumberFieldProps) {
  const id = useId();
  const display = Number(value.toFixed(step === 1 ? 0 : 3));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = String(display);
  }, [display]);
  return (
    <Field label={label} htmlFor={id}>
      <input
        className="input"
        ref={inputRef}
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={display}
        onBlur={(event) => {
          const input = event.currentTarget;
          const next = Number.isFinite(input.valueAsNumber) ? Math.max(min, Math.min(max, input.valueAsNumber)) : value;
          input.value = String(Number(next.toFixed(step === 1 ? 0 : 3)));
          if (Math.abs(next - display) > 1e-6) onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = String(display);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

function IconAction({
  label,
  children,
  disabled,
  onClick,
  pressed,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      icon={children}
    />
  );
}

function formatPlayhead(seconds: number) {
  const hundredths = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  const minutes = Math.floor(hundredths / 6000);
  return `${formatNumber(minutes, 0, 2)}:${formatNumber((hundredths % 6000) / 100, 2, 2, 2)}`;
}

export default function VideoEditor() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const persistence = useDraft();
  const [source, setSource] = useState<Source | null>(null);
  const [metadata, setMetadata] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pane, setPane] = useState<Pane>('cut');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [frameRate, setFrameRate] = useState(30);
  const sourceLoad = useRef(0);
  const preparedSource = useRef<Source | null>(null);
  const lastVolume = useRef(1);
  const sampleRequest = useRef<AbortController | null>(null);
  const soundtrackRequest = useRef<AbortController | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const soundtrackInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { edit, soundtrack, soundtrackDuration, format } = history.present;
  const originalUrl = useObjectUrl(source?.file);
  const frames = useClipThumbnails(originalUrl, metadata?.duration ?? 0);
  const soundtrackUrl = useObjectUrl(soundtrack);
  const ready = !!source && !!metadata;
  const preview = usePreview(edit, ready, (text) => setNotice({ text, error: true }));
  const { clips, duration } = buildTimeline(edit);
  const selected = clips[selectedIndex];
  const trimBounds = history.present.trimBounds[selectedIndex];
  const location = ready ? locateTime(clips, preview.time, edit.speed) : null;
  const trimPoint = location?.index === selectedIndex ? location.source : -1;
  const margin = Math.min(0.01, 0.5 / frameRate);
  const canSplit =
    location && location.source > clips[location.index].start + margin && location.source < clips[location.index].end - margin;
  const canTrim = selected && trimPoint > selected.start + margin && trimPoint < selected.end - margin;
  const canResetTrim = selected && trimBounds && (selected.start !== trimBounds.start || selected.end !== trimBounds.end);
  const exporting = !!job && 'progress' in job;
  const controlsDisabled = loadingAudio || leaving;

  function report(text: string) {
    setNotice({ text, error: true });
  }

  function openVideo(file: File, sample = false) {
    sourceLoad.current++;
    sampleRequest.current?.abort();
    setLoadingSample(false);
    setNotice(null);
    setFrameRate(30);
    preparedSource.current = null;
    setSource({ file, sample });
  }

  function sourceError() {
    sourceLoad.current++;
    preview.pause();
    setSource(null);
    setMetadata(null);
    setHistory({ past: [], present: initial, future: [] });
    report('This video could not be opened. Try an MP4 with H.264 video or a WebM file.');
  }

  const failImport = useEffectEvent(sourceError);
  useEffect(() => {
    if (!source || metadata) return;
    const timeout = window.setTimeout(() => {
      if (!preparedSource.current) failImport();
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [source, metadata]);

  const abortRequests = useEffectEvent(() => {
    sourceLoad.current++;
    sampleRequest.current?.abort();
    soundtrackRequest.current?.abort();
    exportRequest.current?.abort();
  });
  useEffect(() => () => abortRequests(), []);

  // Pin the source instance through metadata, history and asynchronous rate detection.
  async function loadMetadata(video: HTMLVideoElement) {
    if (!source || preparedSource.current === source) return;
    const size = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    if (!size.width || !size.height || !Number.isFinite(size.duration) || size.duration <= 0) {
      sourceError();
      return;
    }
    preparedSource.current = source;
    const generation = sourceLoad.current;
    const restored = await persistence.restore(source.file, source.sample).catch(() => null);
    if (generation !== sourceLoad.current) return;

    const fallbackSegment = { start: 0, end: size.duration };
    const validRanges = restored?.edit.segments.every(({ start, end }) => start >= 0 && end > start && start < size.duration);
    const segments =
      validRanges && restored?.edit.segments.length
        ? restored.edit.segments.map(({ start, end }) => ({ start, end: Math.min(end, size.duration) }))
        : [fallbackSegment];
    const draft =
      restored && validRanges && restored.edit.segments.length
        ? {
            ...restored,
            edit: { ...restored.edit, segments },
            trimBounds: segments.map((segment, index) => {
              const bounds = restored.trimBounds?.[index] ?? segment;
              return { start: bounds.start, end: Math.min(bounds.end, size.duration) };
            }),
          }
        : { ...initial, edit: { ...initial.edit, segments }, trimBounds: segments };
    lastVolume.current = draft.edit.volume || 1;
    setHistory({ past: [], present: draft, future: [] });
    setSelectedIndex(0);
    setPane('cut');
    setMetadata(size);
    preview.seek(0, draft.edit);
    title.current?.focus({ preventScroll: true });
    void readFrameRate(source.file)
      .then((rate) => {
        if (generation === sourceLoad.current) setFrameRate(rate);
      })
      .catch(() => undefined);
  }

  async function openSample() {
    const controller = new AbortController();
    sampleRequest.current?.abort();
    sampleRequest.current = controller;
    setLoadingSample(true);
    setNotice(null);
    try {
      const probe = document.createElement('video');
      const format = probe.canPlayType('video/mp4; codecs="avc1.64001e"') ? 'mp4' : 'webm';
      const name = `workspace-demo.${format}`;
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Sample unavailable');
      const blob = await response.blob();
      if (!controller.signal.aborted) openVideo(new File([blob], name, { type: `video/${format}` }), true);
    } catch {
      if (!controller.signal.aborted) report('The sample video could not be loaded. Choose a video or try again.');
    } finally {
      if (sampleRequest.current === controller) {
        sampleRequest.current = null;
        setLoadingSample(false);
      }
    }
  }

  async function leave(exit: boolean) {
    if (leaving) return;
    setLeaving(true);
    preview.pause();
    const saved = await persistence.flush();
    if (!saved && !window.confirm(t('Your edits could not be saved on this device. Leave this video anyway?'))) {
      setLeaving(false);
      return;
    }
    abortMedia();
    if (exit) {
      navigate('/');
      return;
    }
    setLeaving(false);
    setSource(null);
    setMetadata(null);
    setHistory({ past: [], present: initial, future: [] });
    setJob(null);
    setNotice(null);
    setLoadingAudio(false);
    setLoadingSample(false);
  }

  function abortMedia() {
    sourceLoad.current++;
    sampleRequest.current?.abort();
    soundtrackRequest.current?.abort();
    exportRequest.current?.abort();
    sampleRequest.current = null;
    soundtrackRequest.current = null;
    exportRequest.current = null;
  }

  function apply(next: Draft, seekTime?: number, select = selectedIndex) {
    if (leaving) return;
    setHistory({ past: [...history.past.slice(-79), history.present], present: next, future: [] });
    if (seekTime !== undefined) preview.seek(seekTime, next.edit);
    setSelectedIndex(select);
    persistence.schedule(next);
  }

  function updateEdit(update: Partial<VideoEdit>) {
    const next = { ...edit, ...update };
    if (update.speed !== undefined) preview.seek((preview.time * edit.speed) / next.speed, next);
    apply({ ...history.present, edit: next });
  }

  function changeHistory(direction: 'undo' | 'redo') {
    const undo = direction === 'undo';
    const snapshot = undo ? history.past.at(-1) : history.future[0];
    if (!snapshot || leaving) return;
    const next = { ...snapshot, format };
    setHistory(
      undo
        ? { past: history.past.slice(0, -1), present: next, future: [history.present, ...history.future] }
        : { past: [...history.past, history.present], present: next, future: history.future.slice(1) },
    );
    const { clips: nextClips, duration: nextDuration } = buildTimeline(next.edit);
    const sameClip = next.trimBounds.findIndex(({ start, end }) => start === trimBounds?.start && end === trimBounds?.end);
    if (sameClip >= 0) {
      const clip = nextClips[sameClip];
      const sourceTime = location?.index === selectedIndex ? location.source : clip.start;
      const inside = Math.max(0, Math.min(clip.length - 1e-6, (sourceTime - clip.start) / next.edit.speed));
      preview.seek(clip.at + inside, next.edit);
      setSelectedIndex(sameClip);
    } else {
      const nextTime = Math.min(preview.time, nextDuration);
      setSelectedIndex(locateTime(nextClips, nextTime, next.edit.speed).index);
      preview.seek(nextTime, next.edit);
    }
    persistence.schedule(next);
  }

  function split() {
    if (!canSplit || !location) return;
    const { index, source: point } = location;
    const next = edit.segments.slice();
    const nextBounds = history.present.trimBounds.slice();
    next.splice(index, 1, { start: next[index].start, end: point }, { start: point, end: next[index].end });
    nextBounds.splice(index, 1, { start: nextBounds[index].start, end: point }, { start: point, end: nextBounds[index].end });
    const updated = { ...edit, segments: next };
    apply({ ...history.present, edit: updated, trimBounds: nextBounds }, buildTimeline(updated).clips[index + 1].at, index + 1);
  }

  function cut() {
    if (!selected || clips.length < 2) return;
    const segments = edit.segments.filter((_, index) => index !== selectedIndex);
    const nextBounds = history.present.trimBounds.filter((_, index) => index !== selectedIndex);
    const updated = { ...edit, segments };
    const remaining = Math.min(selectedIndex, segments.length - 1);
    apply({ ...history.present, edit: updated, trimBounds: nextBounds }, buildTimeline(updated).clips[remaining].at, remaining);
  }

  function moveClip(direction: -1 | 1) {
    const destination = selectedIndex + direction;
    if (!selected || !clips[destination]) return;
    const segments = edit.segments.slice();
    const bounds = history.present.trimBounds.slice();
    [segments[selectedIndex], segments[destination]] = [segments[destination], segments[selectedIndex]];
    [bounds[selectedIndex], bounds[destination]] = [bounds[destination], bounds[selectedIndex]];
    const updated = { ...edit, segments };
    const newClip = buildTimeline(updated).clips[destination];
    const relativePosition = location?.index === selectedIndex ? preview.time - selected.at : 0;
    apply(
      { ...history.present, edit: updated, trimBounds: bounds },
      newClip.at + Math.min(relativePosition, Math.max(0, newClip.length - 1e-6)),
      destination,
    );
  }

  function resetTrim() {
    if (!canResetTrim) return;
    const segments = edit.segments.map((range, index) => (index === selectedIndex ? trimBounds : range));
    const updated = { ...edit, segments };
    apply({ ...history.present, edit: updated }, buildTimeline(updated).clips[selectedIndex].at);
  }

  function trim(boundary: 'start' | 'end', time: number) {
    if (!selected) return;
    const segment = { ...edit.segments[selectedIndex], [boundary]: time };
    const segments = edit.segments.map((range, index) => (index === selectedIndex ? segment : range));
    const updated = { ...edit, segments };
    const nextClip = buildTimeline(updated).clips[selectedIndex];
    const seekTime = boundary === 'start' ? nextClip.at : nextClip.at + Math.max(0, nextClip.length - 1 / (frameRate * edit.speed));
    preview.seek(seekTime, updated);
    apply({ ...history.present, edit: updated });
  }

  function stepFrame(direction: -1 | 1) {
    preview.seek(preview.time + direction / (frameRate * edit.speed));
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!ready || leaving || event.defaultPrevented || event.isComposing || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, [contenteditable], dialog')) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'z') changeHistory(event.shiftKey ? 'redo' : 'undo');
    else if ((event.metaKey || event.ctrlKey) && key === 'y') changeHistory('redo');
    else if (event.metaKey || event.ctrlKey) return;
    else if (key === ' ' && !target?.closest('button, a')) void preview.togglePlayback();
    else if (key === 'arrowleft' || key === 'arrowright') stepFrame(key === 'arrowleft' ? -1 : 1);
    else if (key === 's') split();
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  async function pickSoundtrack(file: File) {
    if (!matchesAccept(file, audioAccept)) {
      report('Choose a supported audio file for the soundtrack.');
      return;
    }
    const controller = new AbortController();
    soundtrackRequest.current?.abort();
    soundtrackRequest.current = controller;
    setLoadingAudio(true);
    setNotice(null);
    preview.pause();
    try {
      const audioDuration = await readAudioDuration(file, controller.signal);
      if (!controller.signal.aborted) {
        // An audio file can finish opening while another video edit is committed.
        attachSoundtrack.current?.(file, audioDuration);
      }
    } catch {
      if (!controller.signal.aborted) report('This soundtrack could not be opened. Try an MP3, WAV, or AAC file.');
    } finally {
      if (soundtrackRequest.current === controller) {
        soundtrackRequest.current = null;
        setLoadingAudio(false);
      }
    }
  }

  const attachSoundtrack = useRef<(file: File, duration: number) => void>(null);
  attachSoundtrack.current = (file, audioDuration) => {
    apply({ ...history.present, soundtrack: file, soundtrackDuration: audioDuration, edit: { ...edit, audioOffset: 0 } });
  };

  async function exportVideo() {
    if (!source || exportRequest.current || !ready || leaving) return;
    preview.pause();
    const controller = new AbortController();
    exportRequest.current = controller;
    setNotice(null);
    setJob({ progress: 0 });
    try {
      const blob = await exportVideoEdit(
        source.file,
        edit,
        soundtrack,
        format,
        (progress) => {
          if (!controller.signal.aborted && exportRequest.current === controller) setJob({ progress });
        },
        controller.signal,
      );
      if (controller.signal.aborted || exportRequest.current !== controller) return;
      const filename = withSuffix(source.file.name, '-edited', format);
      setJob({ blob, filename });
      downloadBlob(blob, filename);
    } catch (error) {
      if (controller.signal.aborted || exportRequest.current !== controller) return;
      setJob(null);
      report(describeError(error));
    } finally {
      if (exportRequest.current === controller) exportRequest.current = null;
    }
  }

  function cancelExport() {
    exportRequest.current?.abort();
    exportRequest.current = null;
    setJob(null);
    setNotice({ text: 'Export canceled.', error: false });
  }

  const fullCrop = metadata && { x: 0, y: 0, width: metadata.width, height: metadata.height };
  const crop = edit.crop ?? fullCrop;
  function applyRatio(ratio: (typeof ratios)[number]) {
    if (!fullCrop) return;
    if (ratio === 'Free crop') {
      updateEdit({ crop: crop ?? fullCrop });
      return;
    }
    const [w, h] = ratio.split(':').map(Number);
    const width = Math.max(1, Math.min(fullCrop.width, Math.round((fullCrop.height * w) / h)));
    const height = Math.max(1, Math.min(fullCrop.height, Math.round((fullCrop.width * h) / w)));
    updateEdit({ crop: { x: Math.floor((fullCrop.width - width) / 2), y: Math.floor((fullCrop.height - height) / 2), width, height } });
  }

  const formatId = useId();
  const speedId = useId();
  const audioCoverage = Math.max(0, Math.min(duration, edit.audioOffset + soundtrackDuration) - Math.max(0, edit.audioOffset));
  const percent = (time: number) => `${duration ? (100 * time) / duration : 0}%`;
  const rotated = edit.rotation === 90 || edit.rotation === 270;
  const frameWidth = crop && (rotated ? crop.height : crop.width);
  const frameHeight = crop && (rotated ? crop.width : crop.height);
  const previewVolume = Math.round(edit.volume * 100);
  const cropVideo = pane === 'crop' && crop && metadata ? preview.videoRef.current : null;

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        {source ? (
          <IconAction label={t('Back to home')} disabled={leaving} onClick={() => void leave(true)}>
            <ArrowLeft />
          </IconAction>
        ) : (
          <Link className="btn btn-ghost btn-sm btn-icon" to="/" aria-label={t('Back to home')} title={t('Back to home')}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        )}
        <div className={styles.project}>
          <h1 tabIndex={-1} ref={title}>
            {t('Video Editor')}
          </h1>
          {source && <span title={source.file.name}>{source.file.name}</span>}
        </div>
        {ready && (
          <>
            <div className={styles.history}>
              <IconAction label={t('Undo')} disabled={!history.past.length || leaving} onClick={() => changeHistory('undo')}>
                <Undo2 />
              </IconAction>
              <IconAction label={t('Redo')} disabled={!history.future.length || leaving} onClick={() => changeHistory('redo')}>
                <Redo2 />
              </IconAction>
            </div>
            <div className={styles.export}>
              <label htmlFor={formatId} className="sr-only">
                {t('Export format')}
              </label>
              <Select
                id={formatId}
                disabled={exporting || leaving}
                options={[
                  { value: 'mp4', label: 'MP4' },
                  { value: 'webm', label: 'WebM' },
                ]}
                value={format}
                onChange={(event) => {
                  const next = { ...history.present, format: event.currentTarget.value as Draft['format'] };
                  setHistory({ ...history, present: next });
                  persistence.schedule(next);
                }}
              />
              <Button size="sm" disabled={exporting || leaving} icon={<Download />} onClick={() => void exportVideo()}>
                {t('Export')}
              </Button>
            </div>
          </>
        )}
      </header>

      <video
        {...preview.mediaEvents}
        src={originalUrl}
        ref={preview.videoRef}
        hidden
        preload="auto"
        playsInline
        onLoadedMetadata={(event) => void loadMetadata(event.currentTarget)}
        onError={() => {
          if (source && originalUrl) sourceError();
        }}
      />
      <audio
        src={soundtrackUrl}
        ref={preview.soundtrackRef}
        preload="auto"
        hidden
        onError={() => {
          if (soundtrackUrl) report('Could not play the soundtrack in this browser.');
        }}
      />
      <input
        type="file"
        accept={audioAccept}
        hidden
        ref={soundtrackInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void pickSoundtrack(file);
        }}
      />

      <div className={styles.feedback} aria-live="polite">
        {notice && (
          <p role={notice.error ? 'alert' : 'status'} className={notice.error ? styles.error : undefined}>
            {t(notice.text)}
          </p>
        )}
        {ready && persistence.failed && <p className={styles.error}>{t('Your edits could not be saved on this device.')}</p>}
        {job && 'progress' in job && (
          <div className={styles.job}>
            <ProgressBar value={job.progress} label="Exporting video…" indeterminate={job.progress <= 0} />
            <Button size="sm" variant="secondary" onClick={cancelExport}>
              {t('Cancel')}
            </Button>
          </div>
        )}
        {job && 'blob' in job && (
          <div className={styles.job}>
            <span>{t('Video exported.')}</span>
            <Button size="sm" variant="secondary" icon={<Download />} onClick={() => downloadBlob(job.blob, job.filename)}>
              {t('Download')}
            </Button>
          </div>
        )}
      </div>

      {!ready ? (
        <div className={styles.intake}>
          {source ? (
            <p role="status">
              <span className="spinner" aria-hidden="true" /> {t('Opening video…')}
            </p>
          ) : (
            <>
              <FileDrop accept={videoAccept} label="Drop a video here" icon={<Film />} onFiles={([file]) => openVideo(file)} />
              <Button variant="secondary" size="sm" loading={loadingSample} icon={<Play />} onClick={() => void openSample()}>
                {t('Try a sample video')}
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className={styles.body}>
            <aside className={styles.rail} aria-label={t('Video editing tools')}>
              {tools.map(({ id, label, Icon }) => (
                <button key={id} type="button" className={styles.railButton} aria-pressed={pane === id} onClick={() => setPane(id)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{t(label)}</span>
                </button>
              ))}
              <IconAction label={t('Change video')} disabled={leaving} onClick={() => void leave(false)}>
                <FolderOpen />
              </IconAction>
            </aside>
            <section className={styles.stage} aria-label={t('Video preview')}>
              <div className={styles.monitor}>
                <canvas
                  className={styles.canvas}
                  ref={preview.canvasRef}
                  hidden={!!cropVideo}
                  aria-label={t('Current video frame')}
                  role="img"
                />
                {cropVideo && metadata && crop && (
                  <CropFrame
                    video={cropVideo}
                    width={metadata.width}
                    height={metadata.height}
                    crop={crop}
                    onChange={(crop) => updateEdit({ crop })}
                  />
                )}
              </div>
              <div className={styles.transport}>
                <span className={styles.time}>
                  {formatPlayhead(preview.time)} <span>/ {formatPlayhead(duration)}</span>
                </span>
                <div className={styles.playback}>
                  <IconAction label={t('Previous frame')} onClick={() => stepFrame(-1)} disabled={preview.time <= 0}>
                    <SkipBack />
                  </IconAction>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t(preview.playing ? 'Pause' : 'Play')}
                    title={t(preview.playing ? 'Pause' : 'Play')}
                    icon={preview.playing ? <Pause /> : <Play />}
                    onClick={() => void preview.togglePlayback()}
                  />
                  <IconAction label={t('Next frame')} onClick={() => stepFrame(1)} disabled={preview.time >= duration}>
                    <SkipForward />
                  </IconAction>
                </div>
                <div className={styles.frameActions}>
                  <span className={styles.resolution}>
                    {frameWidth} × {frameHeight}
                  </span>
                  <CopyImageButton
                    getImage={preview.copyFrame}
                    disabled={preview.seeking}
                    size="sm"
                    filename={withSuffix(source.file.name, '-frame', 'png')}
                  />
                </div>
              </div>
            </section>
            <section className={styles.inspector} aria-label={t(tools.find((tool) => tool.id === pane)!.label)}>
              <h2>{t(tools.find((tool) => tool.id === pane)!.label)}</h2>
              {pane === 'cut' && selected && (
                <>
                  <div className={styles.actions}>
                    <Button variant="secondary" size="sm" disabled={!canSplit} onClick={split} icon={<Scissors />}>
                      {t('Split at playhead')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={clips.length < 2} onClick={cut} icon={<Trash2 />}>
                      {t('Cut selected clip')}
                    </Button>
                  </div>
                  <fieldset className={styles.inspectorGroup}>
                    <legend>{t('Clip {number}', { number: selectedIndex + 1 })}</legend>
                    <NumberField
                      label={t('Trim in (s)')}
                      value={selected.start}
                      min={trimBounds.start}
                      max={Math.max(selected.start, selected.end - margin)}
                      onChange={(value) => trim('start', value)}
                    />
                    <NumberField
                      label={t('Trim out (s)')}
                      value={selected.end}
                      min={Math.min(selected.end, selected.start + margin)}
                      max={trimBounds.end}
                      onChange={(value) => trim('end', value)}
                    />
                    <div className={styles.actions}>
                      <Button variant="secondary" size="sm" disabled={!canTrim} onClick={() => trim('start', trimPoint)}>
                        {t('Set in to playhead')}
                      </Button>
                      <Button variant="secondary" size="sm" disabled={!canTrim} onClick={() => trim('end', trimPoint)}>
                        {t('Set out to playhead')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canResetTrim} onClick={resetTrim}>
                        {t('Reset trim')}
                      </Button>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={selectedIndex === 0}
                        onClick={() => moveClip(-1)}
                        icon={<ArrowLeft />}
                      >
                        {t('Move earlier')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={selectedIndex + 1 === clips.length}
                        onClick={() => moveClip(1)}
                        icon={<ArrowRight />}
                      >
                        {t('Move later')}
                      </Button>
                    </div>
                  </fieldset>
                </>
              )}
              {pane === 'crop' && crop && fullCrop && (
                <>
                  <div className={styles.ratios} role="group" aria-label={t('Crop aspect ratio')}>
                    {ratios.map((ratio) => (
                      <Button key={ratio} variant="secondary" size="sm" onClick={() => applyRatio(ratio)}>
                        {t(ratio)}
                      </Button>
                    ))}
                  </div>
                  <div className={styles.cropFields}>
                    <NumberField
                      label={t('Left (px)')}
                      value={crop.x}
                      min={0}
                      max={fullCrop.width - crop.width}
                      step={1}
                      onChange={(x) => updateEdit({ crop: { ...crop, x: Math.round(x) } })}
                    />
                    <NumberField
                      label={t('Top (px)')}
                      value={crop.y}
                      min={0}
                      max={fullCrop.height - crop.height}
                      step={1}
                      onChange={(y) => updateEdit({ crop: { ...crop, y: Math.round(y) } })}
                    />
                    <NumberField
                      label={t('Width (px)')}
                      value={crop.width}
                      min={1}
                      max={fullCrop.width - crop.x}
                      step={1}
                      onChange={(width) => updateEdit({ crop: { ...crop, width: Math.round(width) } })}
                    />
                    <NumberField
                      label={t('Height (px)')}
                      value={crop.height}
                      min={1}
                      max={fullCrop.height - crop.y}
                      step={1}
                      onChange={(height) => updateEdit({ crop: { ...crop, height: Math.round(height) } })}
                    />
                  </div>
                  <Button variant="ghost" size="sm" disabled={!edit.crop} onClick={() => updateEdit({ crop: null })}>
                    {t('Reset crop')}
                  </Button>
                </>
              )}
              {pane === 'transform' && (
                <>
                  <div className={styles.transform}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => updateEdit({ rotation: ((edit.rotation + 270) % 360) as VideoEdit['rotation'] })}
                      icon={<RotateCcw />}
                    >
                      {t('Rotate left')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => updateEdit({ rotation: ((edit.rotation + 90) % 360) as VideoEdit['rotation'] })}
                      icon={<RotateCw />}
                    >
                      {t('Rotate right')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-pressed={edit.flipH}
                      onClick={() => updateEdit({ flipH: !edit.flipH })}
                      icon={<FlipHorizontal2 />}
                    >
                      {t('Flip horizontal')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-pressed={edit.flipV}
                      onClick={() => updateEdit({ flipV: !edit.flipV })}
                      icon={<FlipVertical2 />}
                    >
                      {t('Flip vertical')}
                    </Button>
                  </div>
                  <output className={styles.resolution}>{edit.rotation}°</output>
                </>
              )}
              {pane === 'speed' && (
                <Field label={t('Playback speed')} htmlFor={speedId}>
                  <Select
                    id={speedId}
                    value={edit.speed}
                    options={speeds.map((speed) => ({ value: String(speed), label: `${formatNumber(speed, 2)}×` }))}
                    onChange={(event) => updateEdit({ speed: Number(event.currentTarget.value) })}
                  />
                </Field>
              )}
              {pane === 'audio' && (
                <>
                  <fieldset className={styles.inspectorGroup}>
                    <legend>{t('Original audio')}</legend>
                    <div className={styles.gain}>
                      <NumberField
                        label={t('Volume (%)')}
                        value={previewVolume}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(volume) => {
                          if (volume > 0) lastVolume.current = volume / 100;
                          updateEdit({ volume: volume / 100 });
                        }}
                      />
                      <IconAction
                        label={t(edit.volume ? 'Mute' : 'Unmute')}
                        pressed={!edit.volume}
                        onClick={() => {
                          if (edit.volume) lastVolume.current = edit.volume;
                          updateEdit({ volume: edit.volume ? 0 : lastVolume.current });
                        }}
                      >
                        {edit.volume ? <Volume2 /> : <VolumeX />}
                      </IconAction>
                    </div>
                    <div className={styles.cropFields}>
                      {(['fadeIn', 'fadeOut'] as const).map((fade) => {
                        const label = t(fade === 'fadeIn' ? 'Fade in' : 'Fade out');
                        return (
                          <Field key={fade} label={label}>
                            <Select
                              aria-label={label}
                              value={edit[fade]}
                              options={[0, 0.5, 1, 2].map((value) => ({
                                value: String(value),
                                label: value ? `${formatNumber(value, 1)} s` : t('Off'),
                              }))}
                              onChange={(event) => updateEdit({ [fade]: Number(event.currentTarget.value) })}
                            />
                          </Field>
                        );
                      })}
                    </div>
                  </fieldset>
                  <fieldset className={styles.inspectorGroup}>
                    <legend>{t('Soundtrack')}</legend>
                    {soundtrack && (
                      <p className={styles.filename} title={soundtrack.name}>
                        {soundtrack.name}
                      </p>
                    )}
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={loadingAudio}
                        disabled={leaving}
                        icon={<Music2 />}
                        onClick={() => soundtrackInput.current?.click()}
                      >
                        {t(soundtrack ? 'Replace soundtrack' : 'Add soundtrack')}
                      </Button>
                      {soundtrack && (
                        <IconAction
                          label={t('Remove soundtrack')}
                          disabled={controlsDisabled}
                          onClick={() => {
                            preview.pause();
                            apply({ ...history.present, soundtrack: null, soundtrackDuration: 0 });
                          }}
                        >
                          <Trash2 />
                        </IconAction>
                      )}
                    </div>
                    {soundtrack && (
                      <>
                        <NumberField
                          label={t('Soundtrack gain (%)')}
                          value={edit.audioVolume * 100}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(value) => updateEdit({ audioVolume: value / 100 })}
                        />
                        <NumberField
                          label={t('Start offset (s)')}
                          value={edit.audioOffset}
                          min={-soundtrackDuration}
                          max={Math.max(duration, edit.audioOffset)}
                          onChange={(value) => updateEdit({ audioOffset: value })}
                        />
                        <Button variant="ghost" size="sm" onClick={() => updateEdit({ audioOffset: preview.time })}>
                          {t('Start at playhead')}
                        </Button>
                      </>
                    )}
                  </fieldset>
                </>
              )}
            </section>
          </div>

          <section className={styles.timeline} aria-labelledby="video-editor-timeline">
            <div className={styles.timelineHeader}>
              <h2 id="video-editor-timeline">{t('Timeline')}</h2>
              <Button variant="ghost" size="sm" disabled={!canSplit} icon={<Scissors />} onClick={split}>
                {t('Split')}
              </Button>
              <Button variant="ghost" size="sm" disabled={clips.length < 2} icon={<Trash2 />} onClick={cut}>
                {t('Cut')}
              </Button>
            </div>
            <div className={styles.tracks}>
              <div className={styles.trackLabels}>
                <span aria-hidden="true" />
                <span>
                  <Film size={14} aria-hidden="true" />
                  {t('Video')}
                </span>
                <span>
                  <Music2 size={14} aria-hidden="true" />
                  {t('Audio')}
                </span>
              </div>
              <div className={styles.trackArea}>
                <div className={styles.ruler}>
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                    <span key={fraction} style={{ left: `${fraction * 100}%` }}>
                      {formatDuration(duration * fraction)}
                    </span>
                  ))}
                  <input
                    type="range"
                    className={styles.scrubber}
                    min={0}
                    max={duration}
                    value={preview.time}
                    step="any"
                    aria-label={t('Timeline playhead')}
                    aria-valuetext={formatPlayhead(preview.time)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      stepFrame(event.key === 'ArrowLeft' ? -1 : 1);
                    }}
                    onChange={(event) => preview.seek(Number(event.currentTarget.value))}
                  />
                </div>
                <div className={styles.videoTrack}>
                  {clips.map((clip, index) => (
                    <button
                      type="button"
                      key={index}
                      className={styles.clip}
                      style={{ width: percent(clip.length) }}
                      aria-pressed={index === selectedIndex}
                      aria-label={t('Clip {number}', { number: index + 1 })}
                      title={`${formatDuration(clip.start)} – ${formatDuration(clip.end)}`}
                      onClick={() => {
                        setSelectedIndex(index);
                        setPane('cut');
                        preview.seek(clip.at, edit, index);
                      }}
                    >
                      <ClipThumbnails frames={frames} start={clip.start} end={clip.end} />
                      <Film size={14} aria-hidden="true" /> <span>{t('Clip {number}', { number: index + 1 })}</span>
                    </button>
                  ))}
                </div>
                <div className={styles.audioTrack}>
                  {soundtrack && audioCoverage > 0 ? (
                    <button
                      type="button"
                      className={styles.audioClip}
                      style={{ width: percent(audioCoverage), marginLeft: percent(Math.max(0, edit.audioOffset)) }}
                      aria-pressed={pane === 'audio'}
                      onClick={() => setPane('audio')}
                      title={soundtrack.name}
                    >
                      <Music2 size={14} aria-hidden="true" />
                      <span>{soundtrack.name}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.audioPlaceholder}
                      disabled={controlsDisabled}
                      onClick={() => {
                        setPane('audio');
                        if (!soundtrack) soundtrackInput.current?.click();
                      }}
                    >
                      <Music2 size={14} aria-hidden="true" />
                      {t(soundtrack ? 'Edit soundtrack' : 'Add soundtrack')}
                    </button>
                  )}
                </div>
                <div className={styles.playhead} style={{ left: percent(preview.time) }} aria-hidden="true" />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
