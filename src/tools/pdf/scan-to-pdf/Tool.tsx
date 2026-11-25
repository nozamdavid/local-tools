import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { buildPdf, makeThumbnail, normalizeImage, type Enhance, type PageSize } from './scanImage';
import { createPerspectiveCorrectionJob, type PerspectiveCorrectionJob } from './perspectiveClient';
import { validatePerspectiveCorners, type PerspectiveCorners, type Point } from './perspective';
import styles from './Tool.module.css';

interface ScanPage {
  id: number;
  original: Blob;
  blob: Blob;
  corners: PerspectiveCorners | null;
}

interface Thumb {
  mode: Enhance;
  url: string;
}

interface UiMessage {
  key: string;
  params?: Record<string, string | number>;
}

const ENHANCE_OPTIONS = [
  { value: 'none', label: 'Original colors' },
  { value: 'gray', label: 'Grayscale (cleaner paper)' },
  { value: 'bw', label: 'Black and white document' },
];

const SIZE_OPTIONS = [
  { value: 'fit', label: 'Fit to image' },
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'US Letter' },
];

type ScanTranslator = (sourceEnglish: string, params?: Record<string, string | number>) => string;

function translateScanError(message: string, t: ScanTranslator): string {
  const dynamicErrors: Array<[RegExp, string, (match: RegExpMatchArray) => Record<string, string | number>]> = [
    [
      /^Image dimensions must not exceed (\d+) pixels per side\.$/,
      'Image dimensions must not exceed {limit} pixels per side.',
      (match) => ({ limit: match[1] }),
    ],
    [
      /^Output side limit must be between 1 and (\d+)\.$/,
      'Output side limit must be between 1 and {limit}.',
      (match) => ({ limit: match[1] }),
    ],
    [
      /^Page dimensions exceed (\d+) pixels per side\.$/,
      'Page dimensions exceed {limit} pixels per side.',
      (match) => ({ limit: match[1] }),
    ],
  ];

  for (const [pattern, source, params] of dynamicErrors) {
    const match = message.match(pattern);
    if (match) return t(source, params(match));
  }
  return t(message);
}

const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function copyCorners(corners: PerspectiveCorners): PerspectiveCorners {
  return [{ ...corners[0] }, { ...corners[1] }, { ...corners[2] }, { ...corners[3] }];
}

export default function ScanToPdfTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-scan-to-pdf');
  const job = useJob();
  const enhanceId = useId();
  const sizeId = useId();

  const [pages, setPages] = useState<ScanPage[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, Thumb>>({});
  const [enhance, setEnhance] = useState<Enhance>('none');
  const [size, setSize] = useState<PageSize>('a4');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<UiMessage | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorUrl, setEditorUrl] = useState<{ id: number; url: string } | null>(null);
  const [editorDimensions, setEditorDimensions] = useState<{ id: number; width: number; height: number } | null>(null);
  const [editorCorners, setEditorCorners] = useState<PerspectiveCorners | null>(null);
  const [editorError, setEditorError] = useState<UiMessage | null>(null);
  const [warpingId, setWarpingId] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRequest = useRef(0);
  const cameraStream = useRef<MediaStream | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<number | null>(null);
  const nextId = useRef(1);
  const resetEpoch = useRef(0);
  const pageRevisions = useRef(new Map<number, number>());
  const pageJobs = useRef(new Map<number, PerspectiveCorrectionJob>());
  const pagesRef = useRef<ScanPage[]>([]);
  const activeEditId = useRef<number | null>(null);
  const draggingCorner = useRef<{ pageId: number; index: number; pointerId: number } | null>(null);

  const updatePages = useCallback((update: (current: ScanPage[]) => ScanPage[]) => {
    setPages((current) => {
      const next = update(current);
      pagesRef.current = next;
      return next;
    });
  }, []);

  const bumpPageRevision = (id: number) => {
    const revision = (pageRevisions.current.get(id) ?? 0) + 1;
    pageRevisions.current.set(id, revision);
    return revision;
  };

  const cancelPageJob = (id: number) => {
    pageJobs.current.get(id)?.cancel();
    pageJobs.current.delete(id);
  };

  const stopCamera = useCallback(() => {
    cameraRequest.current++;
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setStream(null);
  }, []);

  useEffect(
    () => () => {
      resetEpoch.current++;
      for (const job of pageJobs.current.values()) job.cancel();
      pageJobs.current.clear();
      stopCamera();
    },
    [stopCamera],
  );

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const editingPage = pages.find((page) => page.id === editingId);
  const editingOriginal = editingPage?.original;
  useEffect(() => {
    if (!editingId || !editingOriginal) {
      setEditorUrl(null);
      return;
    }
    const url = URL.createObjectURL(editingOriginal);
    setEditorUrl({ id: editingId, url });
    return () => URL.revokeObjectURL(url);
  }, [editingId, editingOriginal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const page of pages) {
        if (cancelled) return;
        if (thumbs[page.id]?.mode === enhance) continue;
        try {
          const url = await makeThumbnail(page.blob, enhance);
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [page.id]: { mode: enhance, url } }));
        } catch {
          // a page that fails to preview keeps its placeholder
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // thumbs is read to skip finished work; including it would restart the loop on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, enhance]);

  const addBlobs = async (sources: (Blob | HTMLVideoElement)[]) => {
    const epoch = resetEpoch.current;
    const added: ScanPage[] = [];
    for (const item of sources) {
      try {
        const original = await normalizeImage(item);
        if (epoch !== resetEpoch.current) return;
        const id = nextId.current++;
        pageRevisions.current.set(id, 0);
        added.push({ id, original, blob: original, corners: null });
      } catch {
        if (epoch !== resetEpoch.current) return;
        const name = item instanceof File ? item.name : 'the capture';
        setError({ key: 'Could not read {name}. Use a JPG, PNG or WebP image.', params: { name } });
      }
    }
    if (added.length > 0) {
      job.reset();
      updatePages((prev) => [...prev, ...added]);
    }
  };

  const handleUpload = async (files: File[]) => {
    setError(null);
    await addBlobs(files);
  };

  const replacePage = async (id: number, file: File) => {
    const epoch = resetEpoch.current;
    const revision = bumpPageRevision(id);
    cancelPageJob(id);
    setWarpingId((current) => (current === id ? null : current));
    setError(null);
    try {
      const original = await normalizeImage(file);
      if (epoch !== resetEpoch.current || pageRevisions.current.get(id) !== revision || !pagesRef.current.some((page) => page.id === id)) {
        return;
      }
      updatePages((current) => current.map((page) => (page.id === id ? { ...page, original, blob: original, corners: null } : page)));
      setThumbs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (activeEditId.current === id) closeEditor();
      setWarpingId((current) => (current === id ? null : current));
      job.reset();
    } catch {
      if (epoch === resetEpoch.current && pageRevisions.current.get(id) === revision) {
        setError({ key: 'Could not read {name}. Use a JPG, PNG or WebP image.', params: { name: file.name } });
      }
    }
  };

  const handleReplaceInput = (event: ChangeEvent<HTMLInputElement>) => {
    const id = replaceTargetRef.current;
    const file = event.currentTarget.files?.[0];
    replaceTargetRef.current = null;
    event.currentTarget.value = '';
    if (id !== null && file) void replacePage(id, file);
  };

  const openReplace = (id: number) => {
    replaceTargetRef.current = id;
    replaceInputRef.current?.click();
  };

  const openEditor = (page: ScanPage) => {
    draggingCorner.current = null;
    activeEditId.current = page.id;
    setEditingId(page.id);
    setEditorDimensions(null);
    setEditorCorners(page.corners ? copyCorners(page.corners) : null);
    setEditorError(null);
  };

  const closeEditor = () => {
    const id = activeEditId.current;
    if (id !== null && pageJobs.current.has(id)) {
      bumpPageRevision(id);
      cancelPageJob(id);
      setWarpingId((current) => (current === id ? null : current));
    }
    activeEditId.current = null;
    draggingCorner.current = null;
    setEditingId(null);
    setEditorDimensions(null);
    setEditorCorners(null);
    setEditorError(null);
  };

  const resetEditedPage = () => {
    const id = activeEditId.current;
    if (id === null) return;
    bumpPageRevision(id);
    cancelPageJob(id);
    updatePages((current) => current.map((page) => (page.id === id ? { ...page, blob: page.original, corners: null } : page)));
    setThumbs((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setWarpingId(null);
    draggingCorner.current = null;
    if (editorDimensions?.id === id) {
      setEditorCorners([
        { x: 0, y: 0 },
        { x: editorDimensions.width, y: 0 },
        { x: editorDimensions.width, y: editorDimensions.height },
        { x: 0, y: editorDimensions.height },
      ]);
    }
    setEditorError(null);
    job.reset();
  };

  const applyPerspective = () => {
    const id = activeEditId.current;
    const dimensions = editorDimensions;
    const corners = editorCorners;
    const page = id === null ? undefined : pagesRef.current.find((item) => item.id === id);
    if (!page || !dimensions || dimensions.id !== id || !corners) return;
    try {
      validatePerspectiveCorners(corners, dimensions.width, dimensions.height);
    } catch (error) {
      setEditorError({ key: error instanceof Error ? error.message : 'Adjust the corners to outline a page.' });
      return;
    }

    const epoch = resetEpoch.current;
    const revision = bumpPageRevision(id);
    cancelPageJob(id);
    setEditorError(null);
    setWarpingId(id);
    let correction: PerspectiveCorrectionJob;
    try {
      correction = createPerspectiveCorrectionJob(page.original, copyCorners(corners));
    } catch (error) {
      setWarpingId(null);
      setEditorError({ key: error instanceof Error ? error.message : 'Could not start perspective correction.' });
      return;
    }
    pageJobs.current.set(id, correction);

    void correction.promise
      .then((corrected) => {
        if (
          epoch !== resetEpoch.current ||
          pageRevisions.current.get(id) !== revision ||
          !pagesRef.current.some((item) => item.id === id)
        ) {
          return;
        }
        updatePages((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  blob: corrected,
                  corners: copyCorners(corners),
                }
              : item,
          ),
        );
        setThumbs((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        if (activeEditId.current === id) {
          activeEditId.current = null;
          draggingCorner.current = null;
          setEditingId(null);
          setEditorDimensions(null);
          setEditorCorners(null);
          setEditorError(null);
        }
        job.reset();
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (
          epoch === resetEpoch.current &&
          pageRevisions.current.get(id) === revision &&
          pagesRef.current.some((item) => item.id === id) &&
          activeEditId.current === id
        ) {
          setEditorError({ key: error instanceof Error ? error.message : 'Could not correct this page.' });
        }
      })
      .finally(() => {
        if (pageJobs.current.get(id) === correction) pageJobs.current.delete(id);
        if (epoch === resetEpoch.current && pageRevisions.current.get(id) === revision) {
          setWarpingId((current) => (current === id ? null : current));
        }
      });
  };

  const updateEditorPoint = (index: number, point: Point) => {
    setEditorCorners((current) => {
      if (!current) return current;
      const next = current.map((corner) => ({ ...corner })) as [Point, Point, Point, Point];
      next[index] = point;
      return next;
    });
    setEditorError(null);
  };

  const moveEditorPoint = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = draggingCorner.current;
    if (!drag || drag.pageId !== editingId || drag.index !== index || !editorDimensions) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(editorDimensions.width, ((event.clientX - rect.left) / rect.width) * editorDimensions.width));
    const y = Math.max(0, Math.min(editorDimensions.height, ((event.clientY - rect.top) / rect.height) * editorDimensions.height));
    updateEditorPoint(index, { x: Math.round(x), y: Math.round(y) });
  };

  const handleCornerKeyDown = (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editorCorners || !editorDimensions) return;
    const step = event.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else return;
    event.preventDefault();
    const current = editorCorners[index];
    updateEditorPoint(index, {
      x: Math.max(0, Math.min(editorDimensions.width, current.x + dx)),
      y: Math.max(0, Math.min(editorDimensions.height, current.y + dy)),
    });
  };

  const startCamera = async () => {
    stopCamera();
    const request = cameraRequest.current;
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (request !== cameraRequest.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream.current = media;
      setStream(media);
    } catch (err) {
      if (request !== cameraRequest.current) return;
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError({
        key: denied
          ? 'Camera access was denied. Allow it in the browser, or upload photos instead.'
          : 'No camera could be started. Upload photos instead.',
      });
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError({ key: 'The camera is still starting. Try again in a moment.' });
      return;
    }
    setError(null);
    await addBlobs([video]);
  };

  const move = (index: number, delta: number) => {
    updatePages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    job.reset();
  };

  const remove = (id: number) => {
    bumpPageRevision(id);
    cancelPageJob(id);
    updatePages((prev) => prev.filter((p) => p.id !== id));
    setThumbs((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (activeEditId.current === id) closeEditor();
    setWarpingId((current) => (current === id ? null : current));
    job.reset();
  };

  const handleReset = () => {
    resetEpoch.current++;
    for (const page of pagesRef.current) {
      bumpPageRevision(page.id);
      cancelPageJob(page.id);
    }
    activeEditId.current = null;
    draggingCorner.current = null;
    pageRevisions.current.clear();
    stopCamera();
    updatePages(() => []);
    setThumbs({});
    setError(null);
    setWarpingId(null);
    setEditingId(null);
    setEditorDimensions(null);
    setEditorCorners(null);
    setEditorError(null);
    job.reset();
  };

  const handleBuild = () => {
    if (pages.length === 0) return;
    job.run((setProgress) =>
      buildPdf(
        pages.map((p) => p.blob),
        enhance,
        size,
        setProgress,
      ),
    );
  };

  const activeDimensions = editorDimensions?.id === editingId ? editorDimensions : null;
  const activeEditorUrl = editorUrl?.id === editingId ? editorUrl.url : null;
  const handleEditorImageLoad = (pageId: number, event: SyntheticEvent<HTMLImageElement>) => {
    if (activeEditId.current !== pageId) return;
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    if (width < 1 || height < 1) return;
    setEditorDimensions({ id: pageId, width, height });
    const page = pagesRef.current.find((item) => item.id === pageId);
    if (page && !page.corners) {
      setEditorCorners([
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ]);
    }
  };
  let invalidCorners = false;
  if (editorCorners && activeDimensions) {
    try {
      validatePerspectiveCorners(editorCorners, activeDimensions.width, activeDimensions.height);
    } catch {
      invalidCorners = true;
    }
  }
  const editorIsWarping = editingId !== null && warpingId === editingId;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {job.result ? (
        <PdfPreview blob={job.result} filename="scan.pdf" pageCount={pages.length} onReset={handleReset} />
      ) : (
        <div>
          {error && (
            <div className="error-banner" role="alert">
              {t(error.key, error.params)}
            </div>
          )}
          {job.error && (
            <div className="error-banner" role="alert">
              {translateScanError(job.error, t)}
            </div>
          )}
          <input
            ref={replaceInputRef}
            className={styles.hiddenInput}
            type="file"
            accept="image/*"
            onChange={handleReplaceInput}
            tabIndex={-1}
            aria-hidden="true"
          />

          <div className={styles.camera}>
            {!cameraSupported ? (
              <p className={styles.notice}>
                {t(
                  'The camera needs a secure (HTTPS) connection and a supported browser, so it is not available here. Upload photos of your pages below instead.',
                )}
              </p>
            ) : stream ? (
              <div className={styles.viewfinder}>
                <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
                <div className="action-buttons">
                  <Button variant="secondary" onClick={stopCamera}>
                    {t('Stop camera')}
                  </Button>
                  <Button variant="primary" onClick={capture}>
                    {t('Capture page {number}', { number: pages.length + 1 })}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.cameraStart}>
                <Button variant="primary" onClick={startCamera}>
                  {t('Start camera')}
                </Button>
                <span className={styles.hint}>{t('The rear camera is used when your device has one. Photos stay on your device.')}</span>
              </div>
            )}
          </div>

          <FileDrop
            accept="image/*"
            multiple
            label={t('Or choose photos of your pages')}
            hint={t('JPG, PNG or WebP.')}
            onFiles={handleUpload}
          />

          {pages.length > 0 && (
            <>
              <div className={styles.controls}>
                <Field label={t('Enhancement')}>
                  <Select
                    id={enhanceId}
                    value={enhance}
                    onChange={(e) => {
                      job.reset();
                      setEnhance(e.target.value as Enhance);
                    }}
                    options={ENHANCE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
                  />
                </Field>
                <Field label={t('Page size')}>
                  <Select
                    id={sizeId}
                    value={size}
                    onChange={(e) => {
                      job.reset();
                      setSize(e.target.value as PageSize);
                    }}
                    options={SIZE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
                  />
                </Field>
              </div>

              {editingPage && (
                <section className={styles.cornerEditor} aria-labelledby="scan-corner-heading">
                  <div className={styles.editorHeader}>
                    <div>
                      <h2 id="scan-corner-heading">
                        {t('Adjust corners · Page {number}', { number: pages.findIndex((page) => page.id === editingPage.id) + 1 })}
                      </h2>
                      <p className={styles.hint}>
                        {t('Drag each handle. Focus a handle and use arrow keys; hold Shift to move 10 pixels.')}
                      </p>
                    </div>
                  </div>

                  {activeEditorUrl && activeDimensions && editorCorners ? (
                    <>
                      <div
                        ref={stageRef}
                        className={styles.cornerStage}
                        style={{ '--page-aspect': activeDimensions.width / activeDimensions.height } as CSSProperties}
                      >
                        <img
                          key={editingPage.id}
                          src={activeEditorUrl}
                          alt={t('Original page {number} for corner adjustment', {
                            number: pages.findIndex((page) => page.id === editingPage.id) + 1,
                          })}
                          className={styles.cornerImage}
                          draggable={false}
                          onLoad={(event) => handleEditorImageLoad(editingPage.id, event)}
                        />
                        <svg
                          className={styles.cornerOverlay}
                          viewBox={`0 0 ${activeDimensions.width} ${activeDimensions.height}`}
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <polygon points={editorCorners.map((point) => `${point.x},${point.y}`).join(' ')} />
                        </svg>
                        {editorCorners.map((point, index) => {
                          const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
                          return (
                            <button
                              key={names[index]}
                              type="button"
                              className={styles.cornerHandle}
                              style={{
                                left: `${(point.x / activeDimensions.width) * 100}%`,
                                top: `${(point.y / activeDimensions.height) * 100}%`,
                              }}
                              aria-label={t('{corner} corner, X {x}, Y {y}', {
                                corner: t(names[index]),
                                x: Math.round(point.x),
                                y: Math.round(point.y),
                              })}
                              aria-describedby="scan-corner-help"
                              disabled={editorIsWarping}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                draggingCorner.current = { pageId: editingPage.id, index, pointerId: event.pointerId };
                                event.currentTarget.setPointerCapture(event.pointerId);
                              }}
                              onPointerMove={(event) => moveEditorPoint(index, event)}
                              onPointerUp={(event) => {
                                if (draggingCorner.current?.pointerId === event.pointerId) draggingCorner.current = null;
                              }}
                              onPointerCancel={() => {
                                if (draggingCorner.current?.index === index) draggingCorner.current = null;
                              }}
                              onKeyDown={(event) => handleCornerKeyDown(index, event)}
                            >
                              <span className={styles.cornerHandleDot} aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>

                      <p id="scan-corner-help" className={styles.editorHelp}>
                        {t('Corners are measured in image pixels and must stay inside the image without crossing.')}
                      </p>
                      <div className={styles.coordinateGrid} role="group" aria-label={t('Corner coordinates')}>
                        {editorCorners.map((point, index) => {
                          const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
                          return (['x', 'y'] as const).map((axis) => (
                            <label className={styles.coordinateField} key={`${index}-${axis}`}>
                              <span>{t('{corner} {axis}', { corner: t(names[index]), axis: axis.toUpperCase() })}</span>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={axis === 'x' ? activeDimensions.width : activeDimensions.height}
                                step={1}
                                value={point[axis]}
                                disabled={editorIsWarping}
                                aria-label={t('{corner} {axis} coordinate', { corner: t(names[index]), axis: axis.toUpperCase() })}
                                onChange={(event) => {
                                  const value = event.currentTarget.valueAsNumber;
                                  if (!Number.isFinite(value)) return;
                                  updateEditorPoint(index, { ...editorCorners[index], [axis]: value });
                                }}
                              />
                            </label>
                          ));
                        })}
                      </div>

                      {(editorError || invalidCorners) && (
                        <p className={styles.cornerError} role="alert">
                          {editorError
                            ? t(editorError.key, editorError.params)
                            : t('Keep all four corners inside the image and in top-left order without crossing.')}
                        </p>
                      )}
                      <div className="action-buttons">
                        <Button variant="secondary" onClick={closeEditor}>
                          {t('Cancel')}
                        </Button>
                        <Button variant="secondary" onClick={resetEditedPage}>
                          {t('Reset')}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={applyPerspective}
                          disabled={!activeDimensions || invalidCorners}
                          loading={editorIsWarping}
                        >
                          {editorIsWarping ? t('Applying…') : t('Apply')}
                        </Button>
                      </div>
                    </>
                  ) : activeEditorUrl ? (
                    <>
                      <img
                        src={activeEditorUrl}
                        alt=""
                        className={styles.measureImage}
                        onLoad={(event) => handleEditorImageLoad(editingPage.id, event)}
                      />
                      <p className={styles.hint}>{t('Loading page image…')}</p>
                    </>
                  ) : (
                    <p className={styles.hint}>{t('Loading page image…')}</p>
                  )}
                </section>
              )}

              <div className={styles.pageGrid}>
                {pages.map((page, index) => (
                  <div
                    key={page.id}
                    className={`${styles.pageCard} ${editingId === page.id ? styles.pageCardSelected : ''}`}
                    data-scan-page={index + 1}
                  >
                    <div className={styles.thumbBox}>
                      {thumbs[page.id] ? (
                        <img
                          src={thumbs[page.id].url}
                          alt={t('Page {number}', { number: index + 1 })}
                          className={styles.thumb}
                          draggable={false}
                        />
                      ) : (
                        <span className={styles.hint}>…</span>
                      )}
                    </div>
                    <span className={styles.pageLabel}>{t('Page {number}', { number: index + 1 })}</span>
                    {page.corners && <span className={styles.correctedBadge}>{t('Adjusted')}</span>}
                    <button type="button" className={styles.adjustBtn} onClick={() => openEditor(page)} disabled={warpingId !== null}>
                      {t('Adjust corners')}
                    </button>
                    <button type="button" className={styles.replaceBtn} onClick={() => openReplace(page.id)}>
                      {t('Replace page')}
                    </button>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={t('Move page {number} earlier', { number: index + 1 })}
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => remove(page.id)}
                        aria-label={t('Delete page {number}', { number: index + 1 })}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => move(index, 1)}
                        disabled={index === pages.length - 1}
                        aria-label={t('Move page {number} later', { number: index + 1 })}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Building PDF…')} />
              ) : (
                <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Clear all')}
                  </Button>
                  <Button variant="primary" onClick={handleBuild} disabled={editingId !== null || warpingId !== null}>
                    {t('Create PDF from {count} {unit}', { count: pages.length, unit: pages.length === 1 ? t('page') : t('pages') })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </ToolPage>
  );
}
