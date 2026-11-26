import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Brackets,
  Crop,
  Download,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Gauge,
  GripVertical,
  Music2,
  Pause,
  Play,
  Plus,
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
import { normalizeRotation, RotationControl } from '../../components/RotationControl';
import { downloadBlob } from '../../lib/download';
import { describeError } from '../../lib/errors';
import { formatDuration, formatNumber, withSuffix } from '../../lib/format';
import { matchesAccept } from '../../lib/handoff';
import { useI18n } from '../../lib/i18n';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { exportVideoEdit, type VideoEdit } from './engine';
import { buildTimeline, getRotatedFrame, locateTime, readAudioDuration } from './timeline';
import { useClipDrag } from './useClipDrag';
import { useDraft, type Draft } from './useDraft';
import { usePreview } from './usePreview';
import { CropFrame } from './CropFrame';
import { SourceClipThumbnails } from './ClipThumbnails';
import { probeVideoSource, useSourceUrls, type VideoSource } from './videoSources';
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
  { id: 'trim', label: 'Trim', Icon: Brackets },
  { id: 'crop', label: 'Crop', Icon: Crop },
  { id: 'transform', label: 'Transform', Icon: RotateCw },
  { id: 'speed', label: 'Speed', Icon: Gauge },
  { id: 'audio', label: 'Audio', Icon: AudioLines },
] as const;

type NumberFieldProps = { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void };
type History = { past: Draft[]; present: Draft; future: Draft[] };
type Source = VideoSource & { sample: boolean };
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

function restoreDraft(source: VideoSource, restored: Draft | null): Draft {
  if (restored?.edit.segments.length) {
    const sources = [source, ...(restored.additionalSources ?? [])];
    const lengthOf = (segment: { sourceIndex?: number }) => sources[segment.sourceIndex ?? 0]?.duration ?? 0;
    const valid = restored.edit.segments.every((segment) => {
      const { start, end } = segment;
      return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && start < lengthOf(segment);
    });
    if (valid) {
      const segments = restored.edit.segments.map((segment) => ({ ...segment, end: Math.min(segment.end, lengthOf(segment)) }));
      const trimBounds = segments.map((segment, index) => {
        const bounds = restored.trimBounds?.[index];
        if (!bounds || !Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) return segment;
        return {
          ...segment,
          start: Math.max(0, Math.min(bounds.start, segment.start)),
          end: Math.min(lengthOf(segment), Math.max(bounds.end, segment.end)),
        };
      });
      return { ...restored, edit: { ...restored.edit, rotation: normalizeRotation(restored.edit.rotation), segments }, trimBounds };
    }
  }
  const segments = [{ start: 0, end: source.duration }];
  return { ...initial, edit: { ...initial.edit, segments }, trimBounds: segments };
}

function withAddedVideos(draft: Draft, videos: VideoSource[]): Draft {
  const additionalSources = draft.additionalSources ?? [];
  const segments = videos.map(({ duration }, index) => ({ start: 0, end: duration, sourceIndex: additionalSources.length + index + 1 }));
  return {
    ...draft,
    additionalSources: [...additionalSources, ...videos],
    edit: { ...draft.edit, segments: [...draft.edit.segments, ...segments] },
    trimBounds: [...draft.trimBounds, ...segments],
  };
}

export default function VideoEditor() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const persistence = useDraft();
  const [source, setSource] = useState<Source | null>(null);
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const latestHistory = useRef(history);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pane, setPane] = useState<Pane>('trim');
  const [rotationPreview, setRotationPreview] = useState<{ draft: Draft; angle: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean; params?: { file: string } } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const lastVolume = useRef(1);
  const mounted = useRef(false);
  const videoRequest = useRef<AbortController | null>(null);
  const sampleRequest = useRef<AbortController | null>(null);
  const soundtrackRequest = useRef<AbortController | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const videosInput = useRef<HTMLInputElement>(null);
  const soundtrackInput = useRef<HTMLInputElement>(null);
  const playheadInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { edit, soundtrack, soundtrackDuration, format, additionalSources } = history.present;
  const liveEdit = useMemo(
    () => (pane === 'transform' && rotationPreview?.draft === history.present ? { ...edit, rotation: rotationPreview.angle } : edit),
    [edit, history.present, pane, rotationPreview],
  );
  const videos = useMemo(() => (source ? [source, ...(additionalSources ?? [])] : []), [source, additionalSources]);
  const files = useMemo(() => videos.map(({ file }) => file), [videos]);
  const sourceUrls = useSourceUrls(files);
  const metadata = useMemo(() => (source ? { width: source.width, height: source.height } : null), [source]);
  const soundtrackUrl = useObjectUrl(soundtrack);
  const ready = !!source;
  const preview = usePreview(liveEdit, ready, (text) => setNotice({ text, error: true }), sourceUrls, metadata);
  const { clips, duration } = buildTimeline(edit);
  const clipDrag = useClipDrag(edit.segments, moveClipTo);
  const selected = clips[selectedIndex];
  const selectedSource = videos[selected?.sourceIndex ?? 0];
  const trimBounds = history.present.trimBounds[selectedIndex];
  const location = ready ? locateTime(clips, preview.time, edit.speed) : null;
  const playheadRate = videos[clips[location?.index ?? 0]?.sourceIndex ?? 0]?.frameRate ?? 30;
  const frameRate = selectedSource?.frameRate ?? 30;
  const trimPoint = location?.index === selectedIndex ? location.source : -1;
  const margin = Math.min(0.01, 0.5 / frameRate);
  const splitMargin = Math.min(0.01, 0.5 / playheadRate);
  const canSplit =
    location && location.source > clips[location.index].start + splitMargin && location.source < clips[location.index].end - splitMargin;
  const canTrim = selected && trimPoint > selected.start + margin && trimPoint < selected.end - margin;
  const canResetTrim = selected && trimBounds && (selected.start !== trimBounds.start || selected.end !== trimBounds.end);
  const exporting = !!job && 'progress' in job;
  const controlsDisabled = loadingAudio || leaving;

  function report(text: string, params?: { file: string }) {
    setNotice({ text, error: true, params });
  }

  function publishHistory(next: History) {
    latestHistory.current = next;
    setHistory(next);
  }

  const abortOnUnmount = useEffectEvent(abortMedia);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // FileDrop consumes a homepage handoff on mount, including during Strict Mode's effect replay.
      queueMicrotask(() => {
        if (!mounted.current) abortOnUnmount();
      });
    };
  }, []);

  useEffect(() => {
    if (ready) title.current?.focus({ preventScroll: true });
  }, [ready]);

  async function openVideos(selection: File[], append = false, sample = false) {
    if (!selection.length || leaving || (append && videoRequest.current)) return;
    if (!sample) {
      sampleRequest.current?.abort();
      setLoadingSample(false);
    }
    videoRequest.current?.abort();
    const controller = new AbortController();
    videoRequest.current = controller;
    setOpening(selection.length);
    setNotice(null);
    let file = selection[0];
    try {
      const imported: VideoSource[] = [];
      for (const selectedFile of selection) {
        file = selectedFile;
        if (!matchesAccept(file, videoAccept)) throw new Error('Unsupported video type');
        imported.push(await probeVideoSource(file, controller.signal));
      }
      if (controller.signal.aborted || !mounted.current) return;
      if (append) {
        appendVideos.current?.(imported);
        return;
      }
      const [anchor, ...additional] = imported;
      const restored = additional.length ? null : await persistence.restore(anchor.file, sample).catch(() => null);
      if (controller.signal.aborted || !mounted.current) return;
      const baseline = restoreDraft(anchor, restored ?? null);
      const draft = additional.length ? withAddedVideos(baseline, additional) : baseline;
      lastVolume.current = draft.edit.volume || 1;
      publishHistory({ past: additional.length ? [baseline] : [], present: draft, future: [] });
      preview.seek(0, draft.edit, undefined, []);
      setSelectedIndex(0);
      setPane('trim');
      setSource({ ...anchor, sample });
      if (additional.length) {
        persistence.startProject(anchor.file);
        persistence.schedule(draft);
      }
    } catch {
      if (!controller.signal.aborted && mounted.current)
        report('{file} could not be opened. Try an MP4 with H.264 video or a WebM file.', { file: file.name });
    } finally {
      if (videoRequest.current === controller) {
        videoRequest.current = null;
        if (mounted.current) setOpening(null);
      }
    }
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
      if (!controller.signal.aborted) {
        const file = new File([blob], name, { type: `video/${format}` });
        await openVideos([file], false, true);
      }
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
    videoRequest.current?.abort();
    setOpening(null);
    setLeaving(true);
    preview.pause();
    const saved = await persistence.flush();
    if (!saved && !window.confirm(t('Your latest edits will be lost if you leave. Leave this video anyway?'))) {
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
    publishHistory({ past: [], present: initial, future: [] });
    setJob(null);
    setNotice(null);
    setLoadingAudio(false);
    setLoadingSample(false);
  }

  function abortMedia() {
    videoRequest.current?.abort();
    sampleRequest.current?.abort();
    soundtrackRequest.current?.abort();
    exportRequest.current?.abort();
    videoRequest.current = null;
    sampleRequest.current = null;
    soundtrackRequest.current = null;
    exportRequest.current = null;
  }

  function invalidateExport() {
    exportRequest.current?.abort();
    exportRequest.current = null;
    setJob(null);
  }

  function seekEdit(next: Draft, time: number) {
    // A changed source list may reuse a slot for a different file. Wait for its new URL mapping.
    preview.seek(time, next.edit, undefined, next.additionalSources === additionalSources ? sourceUrls : []);
  }

  function apply(next: Draft, seekTime?: number, select?: number) {
    if (leaving) return;
    invalidateExport();
    const current = latestHistory.current;
    publishHistory({ past: [...current.past.slice(-79), current.present], present: next, future: [] });
    if (seekTime !== undefined) seekEdit(next, seekTime);
    if (select !== undefined) setSelectedIndex(select);
    persistence.schedule(next);
  }

  const appendVideos = useRef<(videos: VideoSource[]) => void>(null);
  appendVideos.current = (imported) => {
    if (!source || leaving) return;
    if (source.sample) {
      void persistence.promoteSample(source.file).catch(() => undefined);
      setSource({ ...source, sample: false });
    }
    const current = latestHistory.current.present;
    const timeline = buildTimeline(current.edit);
    setPane('trim');
    apply(withAddedVideos(current, imported), timeline.duration, timeline.clips.length);
  };

  function updateEdit(update: Partial<VideoEdit>) {
    const next = { ...edit, ...update };
    if (update.speed !== undefined) preview.seek((preview.time * edit.speed) / next.speed, next);
    apply({ ...history.present, edit: next });
  }

  function commitRotation(angle: number) {
    const current = latestHistory.current.present;
    if (angle === normalizeRotation(current.edit.rotation)) return;
    apply({ ...current, edit: { ...current.edit, rotation: angle } });
  }

  function changeHistory(direction: 'undo' | 'redo') {
    const undo = direction === 'undo';
    const snapshot = undo ? history.past.at(-1) : history.future[0];
    if (!snapshot || leaving) return;
    const next = { ...snapshot, format };
    invalidateExport();
    publishHistory(
      undo
        ? { past: history.past.slice(0, -1), present: next, future: [history.present, ...history.future] }
        : { past: [...history.past, history.present], present: next, future: history.future.slice(1) },
    );
    const { clips: nextClips, duration: nextDuration } = buildTimeline(next.edit);
    const sameClip = next.trimBounds.findIndex(({ start, end, sourceIndex = 0 }) => {
      const nextSource = sourceIndex === 0 ? source : next.additionalSources?.[sourceIndex - 1];
      return nextSource?.file === selectedSource?.file && start === trimBounds?.start && end === trimBounds?.end;
    });
    if (sameClip >= 0) {
      const clip = nextClips[sameClip];
      const sourceTime = location?.index === selectedIndex ? location.source : clip.start;
      const inside = Math.max(0, Math.min(clip.length - 1e-6, (sourceTime - clip.start) / next.edit.speed));
      seekEdit(next, clip.at + inside);
      setSelectedIndex(sameClip);
    } else {
      const nextTime = Math.min(preview.time, nextDuration);
      setSelectedIndex(locateTime(nextClips, nextTime, next.edit.speed).index);
      seekEdit(next, nextTime);
    }
    persistence.schedule(next);
  }

  function split() {
    if (!canSplit || !location) return;
    const { index, source: point } = location;
    const next = edit.segments.slice();
    const nextBounds = history.present.trimBounds.slice();
    next.splice(index, 1, { ...next[index], end: point }, { ...next[index], start: point });
    nextBounds.splice(index, 1, { ...nextBounds[index], end: point }, { ...nextBounds[index], start: point });
    const updated = { ...edit, segments: next };
    apply({ ...history.present, edit: updated, trimBounds: nextBounds }, buildTimeline(updated).clips[index + 1].at, index + 1);
  }

  function removeClip() {
    if (!selected || clips.length < 2) return;
    const sourceIndex = selected.sourceIndex ?? 0;
    let segments = edit.segments.filter((_, index) => index !== selectedIndex);
    let nextBounds = history.present.trimBounds.filter((_, index) => index !== selectedIndex);
    let nextSources = additionalSources;
    if (sourceIndex > 0 && !segments.some((segment) => segment.sourceIndex === sourceIndex)) {
      nextSources = additionalSources?.filter((_, index) => index !== sourceIndex - 1);
      const shiftSource = (segment: (typeof segments)[number]) =>
        segment.sourceIndex !== undefined && segment.sourceIndex > sourceIndex
          ? { ...segment, sourceIndex: segment.sourceIndex - 1 }
          : segment;
      segments = segments.map(shiftSource);
      nextBounds = nextBounds.map(shiftSource);
    }
    const updated = { ...edit, segments };
    const remaining = Math.min(selectedIndex, segments.length - 1);
    apply(
      { ...history.present, edit: updated, trimBounds: nextBounds, additionalSources: nextSources },
      buildTimeline(updated).clips[remaining].at,
      remaining,
    );
  }

  function moveClipTo(from: number, destination: number) {
    const clip = clips[from];
    if (leaving || !clip || !clips[destination] || from === destination) return;
    const segments = edit.segments.slice();
    const bounds = history.present.trimBounds.slice();
    const [segment] = segments.splice(from, 1);
    const [bound] = bounds.splice(from, 1);
    segments.splice(destination, 0, segment);
    bounds.splice(destination, 0, bound);
    const updated = { ...edit, segments };
    const newClip = buildTimeline(updated).clips[destination];
    const relativePosition = location?.index === from ? preview.time - clip.at : 0;
    apply(
      { ...history.present, edit: updated, trimBounds: bounds },
      newClip.at + Math.min(relativePosition, Math.max(0, newClip.length - 1e-6)),
      destination,
    );
  }

  function moveClip(direction: -1 | 1) {
    moveClipTo(selectedIndex, selectedIndex + direction);
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
    apply({ ...history.present, edit: updated }, seekTime);
  }

  function stepFrame(direction: -1 | 1) {
    const previous = location && direction === -1 && preview.time <= clips[location.index].at ? clips[location.index - 1] : undefined;
    const rate = previous ? videos[previous.sourceIndex ?? 0].frameRate : playheadRate;
    scrubTo(preview.time + direction / (rate * edit.speed));
  }

  function scrubTo(time: number) {
    setSelectedIndex(locateTime(clips, time, edit.speed).index);
    preview.seek(time);
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!ready || leaving || event.defaultPrevented || event.isComposing || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const key = event.key.toLowerCase();
    const splitFromPlayhead = target === playheadInput.current && key === 's' && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (!splitFromPlayhead && target?.closest('input, select, textarea, [contenteditable], dialog')) return;
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
    const current = latestHistory.current.present;
    apply({ ...current, soundtrack: file, soundtrackDuration: audioDuration, edit: { ...current.edit, audioOffset: 0 } });
  };

  async function exportVideo() {
    if (!source || !metadata || exportRequest.current || leaving) return;
    preview.pause();
    const controller = new AbortController();
    exportRequest.current = controller;
    setNotice(null);
    setJob({ progress: 0 });
    try {
      const blob = await exportVideoEdit(
        files,
        edit,
        soundtrack,
        format,
        (progress) => {
          if (!controller.signal.aborted && exportRequest.current === controller) setJob({ progress });
        },
        controller.signal,
        metadata,
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
    invalidateExport();
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
  const openingLabel = opening === 1 ? 'Opening video…' : 'Opening videos…';
  const addingVideos = opening !== null;
  const showSourceNames = videos.length > 1;
  const percent = (time: number) => `${duration ? (100 * time) / duration : 0}%`;
  const outputSize = crop && getRotatedFrame(crop, liveEdit.rotation);
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
          {source && <span>{showSourceNames ? t('{count} videos', { count: formatNumber(videos.length) }) : source.file.name}</span>}
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
                  const current = latestHistory.current;
                  const next = { ...current.present, format: event.currentTarget.value as Draft['format'] };
                  invalidateExport();
                  publishHistory({ ...current, present: next });
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

      <video {...preview.mediaEvents} ref={preview.videoRef} hidden preload="auto" playsInline />
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
        accept={videoAccept}
        multiple
        hidden
        ref={videosInput}
        onChange={(event) => {
          const selection = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void openVideos(selection, true);
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
            {t(notice.text, notice.params)}
          </p>
        )}
        {ready && persistence.status === 'session' && (
          <p role="status">{t('This project is too large to save in this browser. Export your video before leaving.')}</p>
        )}
        {ready && persistence.status === 'conflict' && (
          <p role="status">{t('This project changed or was removed in Recent files. Export your video to keep these edits.')}</p>
        )}
        {ready && persistence.status === 'storage' && (
          <>
            <p className={styles.error}>{t('This project could not be saved. Retry saving or export your video before leaving.')}</p>
            <Button size="sm" variant="secondary" onClick={() => void persistence.flush()}>
              {t('Retry save')}
            </Button>
          </>
        )}
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
          <FileDrop accept={videoAccept} multiple label="Drop videos here" icon={null} onFiles={(files) => void openVideos(files)} />
          <Button
            variant="secondary"
            size="sm"
            loading={loadingSample}
            disabled={addingVideos}
            icon={<Play />}
            onClick={() => void openSample()}
          >
            {t('Try a sample video')}
          </Button>
          {addingVideos && (
            <p role="status">
              <span className="spinner" aria-hidden="true" /> {t(openingLabel)}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className={styles.body}>
            <aside className={styles.rail} aria-label={t('Video editing tools')}>
              <button type="button" className={styles.railButton} title={t('Split at playhead')} disabled={!canSplit} onClick={split}>
                <Scissors size={18} aria-hidden="true" />
                <span>{t('Cut')}</span>
              </button>
              {tools.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.railButton}
                  aria-pressed={pane === id}
                  onClick={() => {
                    setRotationPreview(null);
                    setPane(id);
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{t(label)}</span>
                </button>
              ))}
              <IconAction label={t('Change video')} disabled={leaving} onClick={() => void leave(false)}>
                <FolderOpen />
              </IconAction>
            </aside>
            <section
              className={pane === 'transform' ? `${styles.stage} ${styles.transformStage}` : styles.stage}
              aria-label={t('Video preview')}
            >
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
              {pane === 'transform' && (
                <div className={styles.rotationBar}>
                  <RotationControl
                    angle={edit.rotation}
                    onChange={commitRotation}
                    onPreview={(angle) => setRotationPreview(angle === null ? null : { draft: history.present, angle })}
                    disabled={leaving}
                  />
                </div>
              )}
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
                    {outputSize?.width} × {outputSize?.height}
                  </span>
                  <CopyImageButton
                    getImage={preview.copyFrame}
                    disabled={preview.seeking}
                    size="sm"
                    filename={withSuffix((videos[preview.activeSourceIndex] ?? source).file.name, '-frame', 'png')}
                  />
                </div>
              </div>
            </section>
            <section className={styles.timeline} aria-labelledby="video-editor-timeline">
              <div className={styles.timelineHeader}>
                <h2 id="video-editor-timeline">{t('Timeline')}</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus />}
                  aria-disabled={addingVideos || leaving}
                  onClick={() => {
                    if (!addingVideos && !leaving) videosInput.current?.click();
                  }}
                >
                  {t('Add videos')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('Split at playhead')}
                  aria-keyshortcuts="S"
                  title={t('Split at playhead')}
                  disabled={!canSplit}
                  icon={<Scissors />}
                  onClick={split}
                >
                  {t('Split')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('Remove selected clip')}
                  title={t('Remove selected clip')}
                  disabled={clips.length < 2}
                  icon={<Trash2 />}
                  onClick={removeClip}
                >
                  {t('Remove')}
                </Button>
              </div>
              {addingVideos && (
                <p className={styles.timelineStatus} role="status">
                  {t(openingLabel)}
                </p>
              )}
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
                      ref={playheadInput}
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
                      onChange={(event) => scrubTo(Number(event.currentTarget.value))}
                    />
                  </div>
                  <div className={styles.videoTrack} data-dragging={!!clipDrag.feedback} {...clipDrag.trackEvents}>
                    {clips.map((clip, index) => {
                      const sourceIndex = clip.sourceIndex ?? 0;
                      const clipSource = videos[sourceIndex];
                      const clipNumber = t('Clip {number}', { number: index + 1 });
                      const label = showSourceNames ? clipSource.file.name : clipNumber;
                      const range = `${formatDuration(clip.start)} – ${formatDuration(clip.end)}`;
                      return (
                        <button
                          type="button"
                          key={index}
                          className={clips.length > 1 ? `${styles.clip} ${styles.reorderableClip}` : styles.clip}
                          data-dragged={clipDrag.feedback?.index === index}
                          style={{ width: percent(clip.length) }}
                          aria-pressed={index === selectedIndex}
                          aria-label={showSourceNames ? `${label} (${clipNumber})` : clipNumber}
                          title={showSourceNames ? `${label}\n${range}` : range}
                          onPointerDown={(event) => clipDrag.start(event, index)}
                          onClick={(event) => {
                            if (event.detail === 0) {
                              setSelectedIndex(index);
                              preview.seek(clip.at, edit, index);
                              return;
                            }
                            const { left, width } = event.currentTarget.getBoundingClientRect();
                            const offset = ((event.clientX - left) / width) * clip.length;
                            // Keep clicks at the far edge on this clip.
                            const inside = Math.max(0, Math.min(clip.length - 1e-6, offset));
                            scrubTo(clip.at + inside);
                          }}
                        >
                          <SourceClipThumbnails
                            sourceUrl={sourceUrls[sourceIndex]}
                            duration={clipSource.duration}
                            start={clip.start}
                            end={clip.end}
                          />
                          {clips.length > 1 ? <GripVertical size={14} aria-hidden="true" /> : <Film size={14} aria-hidden="true" />}
                          <span>{label}</span>
                        </button>
                      );
                    })}
                    {clipDrag.feedback?.marker != null && (
                      <span
                        className={styles.clipInsertion}
                        style={{ left: `clamp(2px, ${clipDrag.feedback.marker}px, calc(100% - 2px))` }}
                        aria-hidden="true"
                      />
                    )}
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
              {selected && (
                <div className={styles.timelineSelection}>
                  <div className={styles.timelineClipLabel}>
                    <span>{t('Clip {number}', { number: selectedIndex + 1 })}</span>
                    {showSourceNames && <span title={selectedSource.file.name}>{selectedSource.file.name}</span>}
                  </div>
                  <div className={styles.actions}>
                    <Button variant="ghost" size="sm" disabled={selectedIndex === 0} onClick={() => moveClip(-1)} icon={<ArrowLeft />}>
                      {t('Move earlier')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={selectedIndex + 1 === clips.length}
                      onClick={() => moveClip(1)}
                      icon={<ArrowRight />}
                    >
                      {t('Move later')}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section className={styles.inspector} aria-label={t(tools.find((tool) => tool.id === pane)!.label)}>
              <div className={styles.inspectorHeading}>
                <h2>{t(tools.find((tool) => tool.id === pane)!.label)}</h2>
                {clips.length > 1 && pane !== 'trim' && <span>{t('Entire timeline')}</span>}
              </div>
              {pane === 'trim' && selected && (
                <fieldset className={styles.inspectorGroup}>
                  <legend
                    className={showSourceNames ? styles.clipSourceName : undefined}
                    title={showSourceNames ? selectedSource.file.name : undefined}
                  >
                    {showSourceNames ? selectedSource.file.name : t('Clip {number}', { number: selectedIndex + 1 })}
                  </legend>
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
                </fieldset>
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
                      onClick={() => commitRotation(normalizeRotation(edit.rotation - 90))}
                      icon={<RotateCcw />}
                    >
                      {t('Rotate left')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => commitRotation(normalizeRotation(edit.rotation + 90))}
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
                </>
              )}
              {pane === 'speed' && (
                <div className={styles.speedBar}>
                  <div className={styles.speedOptions} role="radiogroup" aria-label={t('Playback speed')}>
                    {speeds.map((speed) => (
                      <label className={styles.speedOption} key={speed}>
                        <input
                          type="radio"
                          name={speedId}
                          checked={edit.speed === speed}
                          disabled={leaving}
                          onChange={() => updateEdit({ speed })}
                        />
                        <span>{formatNumber(speed, 2)}×</span>
                      </label>
                    ))}
                  </div>
                  <output className={styles.speedDuration} aria-label={t('Output duration')}>
                    {t('{duration} output', { duration: formatDuration(duration) })}
                  </output>
                </div>
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
        </>
      )}
    </div>
  );
}
