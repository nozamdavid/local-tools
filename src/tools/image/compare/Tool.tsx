import { useEffect, useId, useRef, useState } from 'react';
import { Button, Field, SegmentedControl, Slider } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ToolPage } from '../../../components/ToolPage';
import { canvasToBlob, decodeImage, imageToCanvas } from '../../../lib/image';
import { getToolMeta } from '../../registry';
import { translate, useI18n } from '../../../lib/i18n';
import { readComparisonFileDimensions } from './dimensions';
import styles from './Tool.module.css';

const COMPARE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,' + '.jpg,.jpeg,.png,.webp,.gif,.bmp';
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 32_768;
const MAX_PREVIEW_PIXELS = 16_000_000;
const MAX_PREVIEW_DIMENSION = 4096;

interface ComparedImage {
  file: File;
  width: number;
  height: number;
  previewUrl: string;
}

type ViewMode = 'wipe' | 'side-by-side';
type Message = { sourceEnglish: string; params?: Record<string, string | number> };
type LocalizedError = Error & Message;

function localizedError(sourceEnglish: string, params?: Record<string, string | number>): LocalizedError {
  const error = new Error(translate(sourceEnglish, params)) as LocalizedError;
  error.sourceEnglish = sourceEnglish;
  error.params = params;
  return error;
}

function errorMessage(error: unknown): Message {
  if (error instanceof Error && 'sourceEnglish' in error) {
    const localized = error as LocalizedError;
    return { sourceEnglish: localized.sourceEnglish, params: localized.params };
  }
  return { sourceEnglish: error instanceof Error ? error.message : 'Could not read this image. Choose a supported local image file.' };
}

async function makeComparedImage(file: File, registerUrl: (url: string) => void): Promise<ComparedImage> {
  if (file.size > MAX_INPUT_BYTES) {
    throw localizedError('{filename} is larger than the 100 MB limit.', { filename: file.name });
  }

  const prefix = await file.slice(0, 4096).text();
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name) || /<svg\b/i.test(prefix)) {
    throw localizedError('SVG files are not supported here. Choose a raster image to keep comparison previews local and safe.');
  }

  await readComparisonFileDimensions(file);
  const image = await decodeImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  ) {
    throw localizedError('{filename} exceeds the 40 megapixel or 32,768 pixel edge limit.', { filename: file.name });
  }

  const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(width, height), Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)));
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const canvas = imageToCanvas(image, previewWidth, previewHeight);
  const previewBlob = await canvasToBlob(canvas, 'image/png');
  canvas.width = 0;
  canvas.height = 0;
  const previewUrl = URL.createObjectURL(previewBlob);
  registerUrl(previewUrl);

  return { file, width, height, previewUrl };
}

export default function CompareTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-compare');
  const [images, setImages] = useState<[ComparedImage | null, ComparedImage | null]>([null, null]);
  const [wipe, setWipe] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>('wipe');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const previewUrls = useRef(new Set<string>());
  const activeRef = useRef(true);
  const busyRef = useRef(false);
  const rangeId = useId();

  useEffect(() => {
    activeRef.current = true;
    const urls = previewUrls.current;
    return () => {
      activeRef.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const registerPreviewUrl = (url: string) => {
    if (!activeRef.current) {
      URL.revokeObjectURL(url);
      throw new DOMException('Comparison closed.', 'AbortError');
    }
    previewUrls.current.add(url);
  };
  const releaseImage = (image: ComparedImage | null) => {
    if (image && previewUrls.current.delete(image.previewUrl)) URL.revokeObjectURL(image.previewUrl);
  };

  const loadIntoSlots = async (files: File[]) => {
    if (files.length === 0) return;
    if (busyRef.current) {
      setError({ sourceEnglish: 'An image is still loading. Please add the next image when it finishes.' });
      return;
    }
    busyRef.current = true;
    setError(null);
    setLoading(true);

    const next = [...images] as [ComparedImage | null, ComparedImage | null];
    const newImages: ComparedImage[] = [];
    try {
      for (const file of files) {
        const slot = next.findIndex((image) => image === null);
        if (slot < 0) break;
        const image = await makeComparedImage(file, registerPreviewUrl);
        newImages.push(image);
        next[slot] = image;
      }
      if (files.length > newImages.length) {
        setError({ sourceEnglish: 'Only two images can be compared. Replace an image to choose a different pair.' });
      }
      setImages(next);
    } catch (err) {
      for (const image of newImages) releaseImage(image);
      if (!activeRef.current) return;
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setLoading(false);
    }
  };

  const handleReplace = async (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (busyRef.current) return;
    busyRef.current = true;

    setError(null);
    setLoading(true);
    try {
      const replacement = await makeComparedImage(file, registerPreviewUrl);
      setImages((current) => {
        releaseImage(current[index]);
        const next = [...current] as [ComparedImage | null, ComparedImage | null];
        next[index] = replacement;
        return next;
      });
      setWipe(50);
    } catch (err) {
      if (!activeRef.current) return;
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setLoading(false);
    }
  };

  const reset = () => {
    images.forEach(releaseImage);
    setImages([null, null]);
    setWipe(50);
    setViewMode('wipe');
    setError(null);
  };

  const removeImage = (index: number) => {
    releaseImage(images[index]);
    setImages((current) => {
      const next = [...current] as [ComparedImage | null, ComparedImage | null];
      next[index] = null;
      return next;
    });
    setError(null);
  };

  const [first, second] = images;
  const hasAnyImage = images.some(Boolean);
  const dimensionsDiffer = first && second && (first.width !== second.width || first.height !== second.height);
  const incomingDrop = (
    <FileDrop
      accept={COMPARE_ACCEPT}
      multiple
      rememberInHistory={!hasAnyImage}
      label={hasAnyImage ? t('Choose the missing image or drop it here') : t('Choose two images or drop them here')}
      hint={t('PNG, JPG, WebP, GIF or BMP. Convert other formats first.')}
      onFiles={loadIntoSlots}
    />
  );

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-compare">
      <div className={styles.tool}>
        {!hasAnyImage && !loading && incomingDrop}

        {hasAnyImage && (
          <section className={styles.images} aria-label={t('Selected images')}>
            {images.map((image, index) => (
              <div className={styles.imageCard} key={index}>
                <div className={styles.imageSummary}>
                  <strong>{t('Image {label}', { label: index === 0 ? 'A' : 'B' })}</strong>
                  {image ? (
                    <span className={styles.fileName} title={image.file.name}>
                      {image.file.name} · {image.width} × {image.height} px
                    </span>
                  ) : (
                    <span className={styles.fileName}>{t('Add the second image to compare')}</span>
                  )}
                </div>
                {image && (
                  <>
                    <img
                      className={styles.thumbnail}
                      src={image.previewUrl}
                      alt={t('Preview of {filename}', { filename: image.file.name })}
                    />
                    <input
                      ref={(node) => {
                        inputRefs.current[index] = node;
                      }}
                      type="file"
                      accept={COMPARE_ACCEPT}
                      hidden
                      onChange={(event) => void handleReplace(index, event)}
                    />
                    <Button variant="secondary" onClick={() => inputRefs.current[index]?.click()} disabled={loading}>
                      {t('Replace image {label}', { label: index === 0 ? 'A' : 'B' })}
                    </Button>
                    <Button variant="ghost" onClick={() => removeImage(index)} disabled={loading}>
                      {t('Remove image {label}', { label: index === 0 ? 'A' : 'B' })}
                    </Button>
                  </>
                )}
                {!image && !loading && incomingDrop}
              </div>
            ))}
          </section>
        )}

        {error && (
          <div className="error-banner" role="alert">
            {t(error.sourceEnglish, error.params)}
          </div>
        )}
        {loading && (
          <p className={styles.status} role="status">
            {t('Preparing local image previews…')}
          </p>
        )}

        {first && second && (
          <section className={styles.comparison} aria-label={t('Image comparison')}>
            {dimensionsDiffer && (
              <p className={styles.hint}>
                {t(
                  'Dimensions differ ({firstWidth} × {firstHeight} px and {secondWidth} × {secondHeight} px). Each image is contain-fit inside the same comparison area without cropping.',
                  {
                    firstWidth: first.width,
                    firstHeight: first.height,
                    secondWidth: second.width,
                    secondHeight: second.height,
                  },
                )}
              </p>
            )}

            <div className={styles.modeRow}>
              <span className={styles.modeLabel}>{t('Compare')}</span>
              <SegmentedControl<ViewMode>
                value={viewMode}
                options={[
                  { value: 'wipe', label: t('Wipe') },
                  { value: 'side-by-side', label: t('Side by side') },
                ]}
                onChange={setViewMode}
                aria-label={t('Comparison view')}
              />
            </div>

            {viewMode === 'wipe' ? (
              <>
                <div className={styles.stage}>
                  <img className={styles.stageImage} src={first.previewUrl} alt={t('Image A: {filename}', { filename: first.file.name })} />
                  <div className={styles.reveal} style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
                    <img
                      className={styles.stageImage}
                      src={second.previewUrl}
                      alt={t('Image B: {filename}', { filename: second.file.name })}
                    />
                  </div>
                  <span className={`${styles.imageLabel} ${styles.labelA}`}>A</span>
                  <span className={`${styles.imageLabel} ${styles.labelB}`}>B</span>
                  <div className={styles.divider} style={{ left: `${wipe}%` }} aria-hidden="true" />
                </div>
                <Field
                  label={t('Wipe position')}
                  hint={t('Use the arrow keys to move the divider; the range shows more of image B as it moves right.')}
                >
                  <Slider id={rangeId} value={wipe} min={0} max={100} unit="%" onChange={setWipe} />
                </Field>
              </>
            ) : (
              <div className={styles.sideBySide}>
                <figure className={styles.sidePanel}>
                  <figcaption>
                    {t('Image A')} · {first.file.name}
                  </figcaption>
                  <div className={styles.sideStage}>
                    <img
                      className={styles.stageImage}
                      src={first.previewUrl}
                      alt={t('Image A: {filename}', { filename: first.file.name })}
                    />
                  </div>
                </figure>
                <figure className={styles.sidePanel}>
                  <figcaption>
                    {t('Image B')} · {second.file.name}
                  </figcaption>
                  <div className={styles.sideStage}>
                    <img
                      className={styles.stageImage}
                      src={second.previewUrl}
                      alt={t('Image B: {filename}', { filename: second.file.name })}
                    />
                  </div>
                </figure>
              </div>
            )}
          </section>
        )}

        {hasAnyImage && (
          <div className={styles.footer}>
            <Button variant="ghost" onClick={reset} disabled={loading}>
              {t('Start over')}
            </Button>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
