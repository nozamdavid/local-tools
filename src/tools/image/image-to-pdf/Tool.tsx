import { useState, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { formatBytes } from '../../../lib/format';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { imagesToPdf, type PageSizeOption, type OrientationOption, type MarginOption } from '../_pdf/imageToPdf';
import { PdfPreview } from '../_pdf/PdfPreview';
import styles from './Tool.module.css';

function ImageCard({
  file,
  index,
  total,
  onMove,
  onRemove,
}: {
  file: File;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const url = useObjectUrl(file);

  return (
    <div className={styles.thumbCard}>
      <span className={styles.badgeIndex}>#{index + 1}</span>
      <div className={styles.thumbImgWrapper}>{url ? <img src={url} alt={file.name} className={styles.thumbImg} /> : null}</div>
      <div className={styles.thumbMeta}>
        <span className={styles.thumbName} title={file.name}>
          {file.name}
        </span>
        <span className={styles.thumbSize}>{formatBytes(file.size)}</span>
      </div>
      <div className={styles.thumbControls}>
        <button
          type="button"
          className={styles.iconBtn}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          title={t('Move earlier')}
        >
          ◀
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
          title={t('Move later')}
        >
          ▶
        </button>
        <button type="button" className={`${styles.iconBtn} ${styles.removeBtn}`} onClick={() => onRemove(index)} title={t('Remove image')}>
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ImageToPdfTool({ toolId = 'img-image-to-pdf' }: { toolId?: string }) {
  const { t } = useI18n();
  const meta = getToolMeta(toolId);
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeOption>('a4');
  const [orientation, setOrientation] = useState<OrientationOption>('auto');
  const [margin, setMargin] = useState<MarginOption>('small');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  const pageSizeId = useId();
  const orientationId = useId();
  const marginId = useId();

  const handleFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setFiles((prev) => [...prev, ...newFiles]);
    job.reset();
  };

  const handleMove = (from: number, to: number) => {
    setFiles((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };

  const handleRemove = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleReset = () => {
    setFiles([]);
    job.reset();
  };

  const handleConvert = () => {
    if (files.length === 0) return;

    job.run(async (setProgress) => {
      return await imagesToPdf(files, {
        pageSize,
        orientation,
        margin,
        onProgress: (cur, tot) => {
          setProgress(tot > 0 ? cur / tot : 0);
        },
      });
    });
  };

  const totalInputSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label={t('Choose images or drag them here')}
          hint={t('Supports JPG, PNG, WebP, GIF, SVG, BMP, HEIC and more.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result ? (
            <PdfPreview
              blob={job.result}
              filename="images.pdf"
              originalSize={totalInputSize}
              pageCount={files.length}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div className="meta-chips">
                  <span className="meta-chip">
                    {t('Images')}: <strong>{files.length}</strong>
                  </span>
                  <span className="meta-chip">
                    {t('Total size')}: <strong>{formatBytes(totalInputSize)}</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files) handleFiles(Array.from(e.target.files));
                      e.target.value = '';
                    }}
                  />
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    {t('Add more images')}
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Clear all')}
                  </Button>
                </div>
              </div>

              <div className={styles.thumbnailsGrid}>
                {files.map((file, idx) => (
                  <ImageCard
                    key={`${file.name}-${idx}-${file.size}`}
                    file={file}
                    index={idx}
                    total={files.length}
                    onMove={handleMove}
                    onRemove={handleRemove}
                  />
                ))}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Combining images into PDF...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label={t('Page size')} hint={t('Fit to image creates pages sized exactly to each image.')}>
                    <Select
                      id={pageSizeId}
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as PageSizeOption)}
                      options={[
                        { value: 'a4', label: t('A4 (210 × 297 mm)') },
                        { value: 'letter', label: t('US Letter (8.5 × 11 in)') },
                        { value: 'fit', label: t('Fit to image (natural dimensions)') },
                      ]}
                    />
                  </Field>

                  {pageSize !== 'fit' && (
                    <Field label={t('Page orientation')} hint={t("Auto sets landscape or portrait based on each image's shape.")}>
                      <Select
                        id={orientationId}
                        value={orientation}
                        onChange={(e) => setOrientation(e.target.value as OrientationOption)}
                        options={[
                          { value: 'auto', label: t('Auto (match image orientation)') },
                          { value: 'portrait', label: t('Portrait') },
                          { value: 'landscape', label: t('Landscape') },
                        ]}
                      />
                    </Field>
                  )}

                  <Field label={t('Page margins')} hint={t('White margin around images on the page.')}>
                    <Select
                      id={marginId}
                      value={margin}
                      onChange={(e) => setMargin(e.target.value as MarginOption)}
                      options={[
                        { value: 'none', label: t('None (edge-to-edge)') },
                        { value: 'small', label: t('Small (18 pt / 0.25 in)') },
                        { value: 'large', label: t('Large (36 pt / 0.5 in)') },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different files')}
                    </Button>
                    <Button variant="primary" onClick={handleConvert}>
                      {t('Create PDF')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
