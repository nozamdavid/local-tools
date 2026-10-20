import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useJob } from '../../../lib/useJob';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import {
  buildPdf,
  makeThumbnail,
  normalizeImage,
  type Enhance,
  type PageSize,
} from './scanImage';
import styles from './Tool.module.css';

interface ScanPage {
  id: number;
  blob: Blob;
}

interface Thumb {
  mode: Enhance;
  url: string;
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

const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export default function ScanToPdfTool() {
  const meta = getToolMeta('pdf-scan-to-pdf');
  const job = useJob();
  const enhanceId = useId();
  const sizeId = useId();

  const [pages, setPages] = useState<ScanPage[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, Thumb>>({});
  const [enhance, setEnhance] = useState<Enhance>('none');
  const [size, setSize] = useState<PageSize>('a4');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const nextId = useRef(1);

  const stopCamera = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

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
    const added: ScanPage[] = [];
    for (const item of sources) {
      try {
        added.push({ id: nextId.current++, blob: await normalizeImage(item) });
      } catch {
        const name = item instanceof File ? item.name : 'the capture';
        setError(`Could not read ${name}. Use a JPG, PNG or WebP image.`);
      }
    }
    if (added.length > 0) {
      job.reset();
      setPages((prev) => [...prev, ...added]);
    }
  };

  const handleUpload = async (files: File[]) => {
    setError(null);
    await addBlobs(files);
  };

  const startCamera = async () => {
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
      setStream(media);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError(
        denied
          ? 'Camera access was denied. Allow it in the browser, or upload photos instead.'
          : 'No camera could be started. Upload photos instead.'
      );
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError('The camera is still starting. Try again in a moment.');
      return;
    }
    setError(null);
    await addBlobs([video]);
  };

  const move = (index: number, delta: number) => {
    setPages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    job.reset();
  };

  const remove = (id: number) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
    setThumbs(({ [id]: _removed, ...rest }) => rest);
    job.reset();
  };

  const handleReset = () => {
    stopCamera();
    setPages([]);
    setThumbs({});
    setError(null);
    job.reset();
  };

  const handleBuild = () => {
    if (pages.length === 0) return;
    job.run((setProgress) =>
      buildPdf(
        pages.map((p) => p.blob),
        enhance,
        size,
        setProgress
      )
    );
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {job.result ? (
        <PdfPreview
          blob={job.result}
          filename="scan.pdf"
          pageCount={pages.length}
          onReset={handleReset}
        />
      ) : (
        <div>
          {error && <div className="error-banner">{error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className={styles.camera}>
            {!cameraSupported ? (
              <p className={styles.notice}>
                The camera needs a secure (HTTPS) connection and a supported browser, so it is not
                available here. Upload photos of your pages below instead.
              </p>
            ) : stream ? (
              <div className={styles.viewfinder}>
                <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
                <div className="action-buttons">
                  <Button variant="secondary" onClick={stopCamera}>
                    Stop camera
                  </Button>
                  <Button variant="primary" onClick={capture}>
                    Capture page {pages.length + 1}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.cameraStart}>
                <Button variant="primary" onClick={startCamera}>
                  Start camera
                </Button>
                <span className={styles.hint}>
                  The rear camera is used when your device has one. Photos stay on your device.
                </span>
              </div>
            )}
          </div>

          <FileDrop
            accept="image/*"
            multiple
            label="Or choose photos of your pages"
            hint="JPG, PNG or WebP. 100% on-device."
            onFiles={handleUpload}
          />

          {pages.length > 0 && (
            <>
              <div className={styles.controls}>
                <Field label="Enhancement">
                  <Select
                    id={enhanceId}
                    value={enhance}
                    onChange={(e) => setEnhance(e.target.value as Enhance)}
                    options={ENHANCE_OPTIONS}
                  />
                </Field>
                <Field label="Page size">
                  <Select
                    id={sizeId}
                    value={size}
                    onChange={(e) => setSize(e.target.value as PageSize)}
                    options={SIZE_OPTIONS}
                  />
                </Field>
              </div>

              <div className={styles.pageGrid}>
                {pages.map((page, index) => (
                  <div key={page.id} className={styles.pageCard} data-scan-page={index + 1}>
                    <div className={styles.thumbBox}>
                      {thumbs[page.id] ? (
                        <img
                          src={thumbs[page.id].url}
                          alt={`Page ${index + 1}`}
                          className={styles.thumb}
                          draggable={false}
                        />
                      ) : (
                        <span className={styles.hint}>…</span>
                      )}
                    </div>
                    <span className={styles.pageLabel}>Page {index + 1}</span>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move page ${index + 1} earlier`}
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => remove(page.id)}
                        aria-label={`Delete page ${index + 1}`}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => move(index, 1)}
                        disabled={index === pages.length - 1}
                        aria-label={`Move page ${index + 1} later`}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Building PDF…" />
              ) : (
                <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    Clear all
                  </Button>
                  <Button variant="primary" onClick={handleBuild}>
                    Create PDF from {pages.length} {pages.length === 1 ? 'page' : 'pages'}
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
