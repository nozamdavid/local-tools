import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Crop, Download, Images, Pause, Play, Plus, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { ContinueWith } from '../../components/ContinueWith';
import { Button, Field, Input, Select } from '../../components/Controls';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ToolPage } from '../../components/ToolPage';
import { downloadBlob } from '../../lib/download';
import { formatNumber } from '../../lib/format';
import { matchesAccept } from '../../lib/handoff';
import { useI18n } from '../../lib/i18n';
import { decodeImage, IMAGE_ACCEPT, imageToCanvas } from '../../lib/image';
import { rememberRecentFiles } from '../../lib/recentFiles';
import { getRotationCrop } from '../../lib/rotationCrop';
import { useJob } from '../../lib/useJob';
import { drawFrame, getFrameSize, type FrameSettings } from './render';
import styles from './Tool.module.css';

type CropRect = FrameSettings['crop'];
type FrameSize = { width: number; height: number };
type Photo = FrameSize & { file: File; previewUrl: string };
type Position = { x: number; y: number };
type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const ASPECTS = ['16:9', '9:16', '1:1', '4:3'];
const FILENAMES = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const OUTPUT_NAME = 'timelapse.mp4';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function boundedNumber(text: string, fallback: number, min: number, max: number, precision = 1) {
  return clamp(Math.round((text === '' ? fallback : Number(text)) * precision) / precision, min, max);
}

function presetCrop(aspect: string, size: FrameSize, custom: CropRect) {
  if (aspect === 'original') return FULL_CROP;
  if (aspect === 'custom') return custom;

  const [w, h] = aspect.split(':').map(Number);
  const ratio = w / h / (size.width / size.height);
  const width = Math.min(1, ratio);
  const height = Math.min(1, 1 / ratio);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

function adjustCrop(crop: CropRect, handle: CropHandle, { x: dx, y: dy }: Position): CropRect {
  if (handle === 'move') {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
  }

  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const minWidth = Math.min(0.04, crop.width);
  const minHeight = Math.min(0.04, crop.height);
  const west = handle.endsWith('w');
  const north = handle.startsWith('n');
  const x = west ? clamp(crop.x + dx, 0, right - minWidth) : crop.x;
  const y = north ? clamp(crop.y + dy, 0, bottom - minHeight) : crop.y;
  return {
    x,
    y,
    width: (west ? right : clamp(right + dx, x + minWidth, 1)) - x,
    height: (north ? bottom : clamp(bottom + dy, y + minHeight, 1)) - y,
  };
}

function sameCrop(a: CropRect, b: CropRect) {
  return a.x === b.x && a.y === b.y && Math.abs(a.width - b.width) < 1e-8 && Math.abs(a.height - b.height) < 1e-8;
}

async function makePhoto(file: File, signal: AbortSignal): Promise<Photo> {
  const image = await decodeImage(file);
  signal.throwIfAborted();
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) throw new Error('The image has no dimensions.');
  const scale = Math.min(1, 960 / Math.max(width, height));
  const canvas = imageToCanvas(image, width * scale, height * scale);
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    signal.throwIfAborted();
    if (!blob) throw new Error('The image preview could not be created.');
    return { file, width, height, previewUrl: URL.createObjectURL(blob) };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function demoPhotos(signal: AbortSignal) {
  return Promise.all(
    Array.from({ length: 24 }, async (_, index) => {
      const name = `frame-${String(index + 1).padStart(2, '0')}.webp`;
      const response = await fetch(`${import.meta.env.BASE_URL}samples/interval/${name}`, { signal });
      if (!response.ok) throw new Error('The demo photos could not be loaded.');
      return new File([await response.blob()], name, { type: 'image/webp' });
    }),
  );
}

type FramePreviewProps = {
  photo: Photo;
  project: FrameSize;
  settings: FrameSettings;
  output: FrameSize;
  editingCrop: boolean;
  onCrop: (crop: CropRect) => void;
};

function FramePreview({ photo, project, settings, output, editingCrop, onCrop }: FramePreviewProps) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; handle: CropHandle; start: Position; crop: CropRect } | null>(null);
  const [ready, setReady] = useState<{ photo: Photo; image: HTMLImageElement } | null>(null);
  const [failedPhoto, setFailedPhoto] = useState<Photo | null>(null);
  const displayCrop = editingCrop ? FULL_CROP : settings.crop;
  const size = editingCrop ? getFrameSize(project.width, project.height, { angle: settings.angle, crop: FULL_CROP }) : output;
  const scale = Math.min(1, 960 / Math.max(size.width, size.height));
  const canvasWidth = Math.max(1, Math.round(size.width * scale));
  const canvasHeight = Math.max(1, Math.round(size.height * scale));

  useEffect(() => {
    const image = new Image();
    image.onload = () => setReady({ photo, image });
    image.onerror = () => setFailedPhoto(photo);
    image.src = photo.previewUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [photo]);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target || !ready) return;
    try {
      drawFrame(target, ready.image, ready.photo.width, ready.photo.height, project.width, project.height, {
        angle: settings.angle,
        crop: displayCrop,
      });
    } catch {
      setFailedPhoto(ready.photo);
    }
  }, [ready, canvasWidth, canvasHeight, project.width, project.height, settings.angle, displayCrop]);

  function point(event: PointerEvent): Position {
    const bounds = frame.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, handle: CropHandle) {
    if (event.button !== 0 || drag.current) return;
    drag.current = { id: event.pointerId, handle, start: point(event), crop: settings.crop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const current = point(event);
    const next = adjustCrop(active.crop, active.handle, { x: current.x - active.start.x, y: current.y - active.start.y });
    if (!sameCrop(settings.crop, next)) onCrop(next);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, handle: CropHandle) {
    const directions: Record<string, Position> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    const next = adjustCrop(settings.crop, handle, { x: direction.x * step, y: direction.y * step });
    if (!sameCrop(settings.crop, next)) onCrop(next);
  }

  const crop = settings.crop;
  const labels = [
    ['move', t('Move crop. Use the arrow keys.')],
    ['nw', t('Resize crop from top left. Use the arrow keys.')],
    ['ne', t('Resize crop from top right. Use the arrow keys.')],
    ['sw', t('Resize crop from bottom left. Use the arrow keys.')],
    ['se', t('Resize crop from bottom right. Use the arrow keys.')],
  ] as const;

  return (
    <div className={styles.stage}>
      <div
        ref={frame}
        className={styles.frame}
        style={{ '--aspect': size.width / size.height } as CSSProperties}
        onPointerMove={updateDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerUp={(event) => {
          updateDrag(event);
          endDrag(event);
        }}
      >
        <canvas ref={canvas} width={canvasWidth} height={canvasHeight} role="img" aria-label={t('Timelapse frame preview')} />
        {editingCrop && (
          <div
            className={styles.selection}
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
          >
            {labels.map(([handle, label]) => (
              <button
                key={handle}
                type="button"
                className={`${styles.cropControl} ${styles[handle]}`}
                aria-label={label}
                onPointerDown={(event) => startDrag(event, handle)}
                onKeyDown={(event) => handleKeys(event, handle)}
              />
            ))}
          </div>
        )}
      </div>
      {failedPhoto === photo && (
        <p role="status" className={styles.previewError}>
          {t('The image preview could not be created.')}
        </p>
      )}
    </div>
  );
}

export default function Tool() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const job = useJob();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [position, setPosition] = useState(0);
  const [playStart, setPlayStart] = useState<{ index: number; time: number } | null>(null);
  const [fpsText, setFpsText] = useState('24');
  const [repeatsText, setRepeatsText] = useState('3');
  const [rotationText, setRotationText] = useState('0');
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [aspect, setAspect] = useState('original');
  const [customCrop, setCustomCrop] = useState(FULL_CROP);
  const [editingCrop, setEditingCrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<{ files: string } | 'demo' | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const start = useRef<HTMLDivElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const focusPreview = useRef(false);
  const importRequest = useRef<AbortController | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const previewUrls = useRef(new Set<string>());

  const fps = boundedNumber(fpsText, 24, 1, 120);
  const repeats = boundedNumber(repeatsText, 3, 1, 300);
  const fineRotation = boundedNumber(rotationText, 0, -45, 45, 10);
  const angle = quarterTurns * 90 + fineRotation;
  const project = photos[0];
  const photo = photos[position] ?? project;
  const cropSize = project ? getRotationCrop(project.width, project.height, angle) : { width: 1, height: 1 };
  const settings: FrameSettings = { angle, crop: presetCrop(aspect, cropSize, customCrop) };
  const duration = (photos.length * repeats) / fps;
  const running = job.status === 'running';
  const busy = running || loading;
  const hasPhotos = photos.length > 0;

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      importRequest.current?.abort();
      importRequest.current = null;
      exportRequest.current?.abort();
      exportRequest.current = null;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (!hasPhotos || !focusPreview.current) return;
    focusPreview.current = false;
    previewHeading.current?.focus({ preventScroll: true });
  }, [hasPhotos]);

  useEffect(() => {
    if (!playStart || photos.length < 2) return;
    let animation: number;
    const imageMs = (1000 * repeats) / fps;
    function tick(now: number) {
      if (!playStart) return;
      const elapsedImages = Math.floor(Math.max(0, now - playStart.time) / imageMs);
      setPosition((playStart.index + elapsedImages) % photos.length);
      animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playStart, photos.length, repeats, fps]);

  function invalidateExport() {
    job.reset();
    setCanceled(false);
  }

  async function importPhotos(files?: File[]) {
    if (exportRequest.current || files?.length === 0) return;
    importRequest.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    importRequest.current = controller;
    const added: Photo[] = [];
    const rejected: string[] = [];
    let committed = false;

    setLoading(true);
    setImportError(null);
    setPlayStart(null);
    setEditingCrop(false);
    try {
      const selection = files ?? (await demoPhotos(signal));
      for (const file of selection) {
        signal.throwIfAborted();
        if (!matchesAccept(file, IMAGE_ACCEPT)) {
          rejected.push(file.name);
          continue;
        }
        try {
          added.push(await makePhoto(file, signal));
        } catch {
          signal.throwIfAborted();
          rejected.push(file.name);
        }
      }

      signal.throwIfAborted();
      if (rejected.length) setImportError({ files: rejected.join(', ') });
      if (!added.length) return;

      const sequence = [...photos, ...added].sort((a, b) => FILENAMES.compare(a.file.name, b.file.name));
      for (const item of added) previewUrls.current.add(item.previewUrl);
      committed = true;
      if (!hasPhotos) focusPreview.current = !!start.current?.contains(document.activeElement);
      setPhotos(sequence);
      setPosition(photo ? Math.max(0, sequence.indexOf(photo)) : 0);
      invalidateExport();
      if (files)
        void rememberRecentFiles(
          sequence.map((item) => item.file),
          pathname,
        );
    } catch {
      if (!signal.aborted) {
        controller.abort();
        setImportError('demo');
      }
    } finally {
      if (!committed) added.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      if (importRequest.current === controller) {
        importRequest.current = null;
        setLoading(false);
      }
    }
  }

  function reset() {
    importRequest.current?.abort();
    importRequest.current = null;
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setPhotos([]);
    setPlayStart(null);
    setPosition(0);
    setFpsText('24');
    setRepeatsText('3');
    setRotationText('0');
    setQuarterTurns(0);
    setAspect('original');
    setCustomCrop(FULL_CROP);
    setEditingCrop(false);
    setLoading(false);
    setImportError(null);
    invalidateExport();
    document.getElementById('main')?.focus({ preventScroll: true });
  }

  function goTo(index: number) {
    setPlayStart(null);
    setPosition(clamp(index, 0, photos.length - 1));
  }

  function changeRotation(text: string) {
    setPlayStart(null);
    setRotationText(text);
    invalidateExport();
  }

  async function exportVideo() {
    if (exportRequest.current || importRequest.current || !photos.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    exportRequest.current = controller;
    setPlayStart(null);
    setEditingCrop(false);
    setCanceled(false);

    try {
      await job.run(async (progress) => {
        const { exportTimelapse } = await import('./export');
        signal.throwIfAborted();
        const blob = await exportTimelapse(
          photos.map((item) => item.file),
          settings,
          fps,
          repeats,
          signal,
          progress,
        );
        signal.throwIfAborted();
        downloadBlob(blob, OUTPUT_NAME);
        return blob;
      });
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null;
        setCanceling(false);
        if (signal.aborted) {
          job.reset();
          setCanceled(true);
        }
      }
    }
  }

  function cancelExport() {
    setCanceling(true);
    exportRequest.current?.abort();
  }

  const fileError =
    importError === 'demo'
      ? t('The demo photos could not be loaded.')
      : importError && t('Some photos could not be opened: {files}', { files: importError.files });
  const output = project ? getFrameSize(project.width, project.height, settings) : null;
  const playLabel = playStart ? t('Pause preview') : t('Play preview');
  const previousLabel = t('Previous image');
  const nextLabel = t('Next image');
  const positionLabel = t('Image {current} of {total}', { current: formatNumber(position + 1), total: formatNumber(photos.length) });

  return (
    <ToolPage currentId="timelapse" title={t('Timelapse')} description={t('Turn a sequence of photos into a video.')}>
      {!hasPhotos && (
        <div ref={start} className={styles.start}>
          <FileDrop
            accept={IMAGE_ACCEPT}
            multiple
            rememberInHistory={false}
            label="Drop photos here"
            hint="Choose a photo sequence, including HEIC or HEIF."
            icon={<Images />}
            onFiles={(files) => void importPhotos(files)}
          />
          <Button variant="secondary" disabled={loading} onClick={() => void importPhotos()}>
            {t('Try the demo')}
          </Button>
        </div>
      )}

      {loading && <ProgressBar value={0} indeterminate label={t('Opening photos…')} />}
      {fileError && (
        <div className="error-banner" role="alert">
          {fileError}
        </div>
      )}

      {project && photo && output && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.importActions}>
              <input
                ref={addInput}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void importPhotos(files);
                }}
              />
              <Button variant="secondary" icon={<Plus aria-hidden="true" />} disabled={busy} onClick={() => addInput.current?.click()}>
                {t('Import more photos')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                {t('Start over')}
              </Button>
            </div>
            {running ? (
              <Button variant="secondary" disabled={canceling} onClick={cancelExport}>
                {t('Cancel export')}
              </Button>
            ) : (
              <Button icon={<Download aria-hidden="true" />} disabled={loading} onClick={() => void exportVideo()}>
                {t('Export MP4')}
              </Button>
            )}
          </div>

          {running && (
            <ProgressBar
              value={job.progress}
              indeterminate={canceling}
              label={canceling ? t('Canceling export…') : t('Exporting video…')}
            />
          )}
          {canceled && (
            <p className="status-text" role="status">
              {t('Export canceled.')}
            </p>
          )}
          {job.error && (
            <div className="error-banner" role="alert">
              {t(job.error)}
            </div>
          )}
          {job.result && (
            <div className={styles.result}>
              <p role="status">{t('Your MP4 is ready.')}</p>
              <Button variant="secondary" icon={<Download aria-hidden="true" />} onClick={() => downloadBlob(job.result!, OUTPUT_NAME)}>
                {t('Download')}
              </Button>
              <ContinueWith results={[{ blob: job.result, name: OUTPUT_NAME }]} />
            </div>
          )}

          <div
            className={styles.workspace}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              if (!busy) void importPhotos(Array.from(event.dataTransfer.files));
            }}
          >
            <div className={styles.sequence}>
              <div className={styles.panel}>
                <div className={styles.panelHeading}>
                  <h2 ref={previewHeading} tabIndex={-1}>
                    {t('Preview')}
                  </h2>
                  <div className={styles.previewActions}>
                    <span className={styles.metadata}>
                      {formatNumber(output.width)} × {formatNumber(output.height)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={editingCrop ? undefined : <Crop aria-hidden="true" />}
                      disabled={busy}
                      onClick={() => {
                        setPlayStart(null);
                        setEditingCrop(!editingCrop);
                      }}
                    >
                      {editingCrop ? t('Done') : t('Adjust crop')}
                    </Button>
                  </div>
                </div>
                <FramePreview
                  photo={photo}
                  project={project}
                  settings={settings}
                  output={output}
                  editingCrop={editingCrop}
                  onCrop={(crop) => {
                    setAspect('custom');
                    setCustomCrop(crop);
                    invalidateExport();
                  }}
                />
                <div className={styles.transport}>
                  <div className={styles.playback}>
                    <Button
                      variant="ghost"
                      icon={<SkipBack aria-hidden="true" />}
                      title={previousLabel}
                      aria-label={previousLabel}
                      disabled={loading || position === 0}
                      onClick={() => goTo(position - 1)}
                    />
                    <Button
                      variant="secondary"
                      icon={playStart ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                      title={playLabel}
                      aria-label={playLabel}
                      disabled={busy || photos.length < 2 || editingCrop}
                      onClick={() => setPlayStart(playStart ? null : { index: position, time: performance.now() })}
                    />
                    <Button
                      variant="ghost"
                      icon={<SkipForward aria-hidden="true" />}
                      title={nextLabel}
                      aria-label={nextLabel}
                      disabled={loading || position >= photos.length - 1}
                      onClick={() => goTo(position + 1)}
                    />
                  </div>
                  <input
                    type="range"
                    className={styles.scrubber}
                    min={0}
                    max={Math.max(1, photos.length - 1)}
                    value={position}
                    disabled={loading || photos.length < 2}
                    aria-label={t('Preview position')}
                    aria-valuetext={positionLabel}
                    onChange={(event) => goTo(event.target.valueAsNumber)}
                  />
                  <span className={styles.metadata}>{positionLabel}</span>
                </div>
              </div>

              <section className={styles.panel}>
                <div className={styles.panelHeading}>
                  <h2>{t('Image sequence')}</h2>
                  <span className={styles.metadata}>{t('Sorted by filename')}</span>
                </div>
                <ul className={styles.filmstrip} aria-label={t('Image sequence')}>
                  {photos.map((item, index) => (
                    <li key={item.previewUrl}>
                      <button
                        type="button"
                        className={styles.thumbnail}
                        aria-current={position === index ? 'true' : undefined}
                        title={item.file.name}
                        disabled={loading}
                        onClick={() => goTo(index)}
                      >
                        <img src={item.previewUrl} alt="" loading="lazy" decoding="async" />
                        <span>{item.file.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <fieldset className={`${styles.panel} ${styles.settings}`} disabled={busy}>
              <legend className="sr-only">{t('Video settings')}</legend>
              <section className={styles.settingSection}>
                <h2>{t('Timing')}</h2>
                <div className={styles.fieldPair}>
                  <Field label={t('Frame rate (FPS)')}>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      step={1}
                      inputMode="numeric"
                      value={fpsText}
                      onChange={(event) => {
                        setPlayStart(null);
                        setFpsText(event.target.value);
                        invalidateExport();
                      }}
                      onBlur={() => setFpsText(String(fps))}
                    />
                  </Field>
                  <Field label={t('Frames per image')}>
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      step={1}
                      inputMode="numeric"
                      value={repeatsText}
                      onChange={(event) => {
                        setPlayStart(null);
                        setRepeatsText(event.target.value);
                        invalidateExport();
                      }}
                      onBlur={() => setRepeatsText(String(repeats))}
                    />
                  </Field>
                </div>
                <div className={styles.duration}>
                  <span>{t('Estimated duration')}</span>
                  <output className={styles.metadata}>{t('{seconds} s', { seconds: formatNumber(duration, 3) })}</output>
                </div>
              </section>

              <section className={styles.settingSection}>
                <h2>{t('Crop')}</h2>
                <Field label={t('Aspect ratio')}>
                  <Select
                    value={aspect}
                    options={[
                      { value: 'original', label: t('Original') },
                      ...ASPECTS.map((ratio) => ({ value: ratio, label: ratio })),
                      { value: 'custom', label: t('Custom') },
                    ]}
                    onChange={(event) => {
                      setPlayStart(null);
                      if (event.target.value === 'custom') setCustomCrop(settings.crop);
                      setAspect(event.target.value);
                      invalidateExport();
                    }}
                  />
                </Field>
              </section>

              <section className={styles.settingSection}>
                <div className={styles.settingHeading}>
                  <h2>{t('Rotation')}</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('Reset rotation')}
                    disabled={angle === 0}
                    onClick={() => {
                      setQuarterTurns(0);
                      changeRotation('0');
                    }}
                  >
                    {t('Reset')}
                  </Button>
                </div>
                <Field label={t('Fine rotation (°)')}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={-45}
                    max={45}
                    step={0.1}
                    value={rotationText}
                    onChange={(event) => changeRotation(event.target.value)}
                    onBlur={() => setRotationText(String(fineRotation))}
                  />
                </Field>
                <input
                  className={styles.scrubber}
                  type="range"
                  min={-45}
                  max={45}
                  step={0.1}
                  value={fineRotation}
                  aria-label={t('Fine rotation slider')}
                  aria-valuetext={`${formatNumber(fineRotation, 1)}°`}
                  onChange={(event) => changeRotation(event.target.value)}
                />
                <Button
                  variant="secondary"
                  icon={<RotateCw aria-hidden="true" />}
                  onClick={() => {
                    setPlayStart(null);
                    setQuarterTurns((turns) => (turns + 1) % 4);
                    invalidateExport();
                  }}
                >
                  {t('Rotate 90°')}
                </Button>
              </section>
            </fieldset>
          </div>
        </>
      )}
    </ToolPage>
  );
}
