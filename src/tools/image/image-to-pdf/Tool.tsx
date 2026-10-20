import { useState, useRef, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { useJob } from '../../../lib/useJob';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import {
  imagesToPdf,
  type PageSizeOption,
  type OrientationOption,
  type MarginOption,
} from '../_pdf/imageToPdf';
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
  const url = useObjectUrl(file);

  return (
    <div className={styles.thumbCard}>
      <span className={styles.badgeIndex}>#{index + 1}</span>
      <div className={styles.thumbImgWrapper}>
        {url ? <img src={url} alt={file.name} className={styles.thumbImg} /> : null}
      </div>
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
          title="Move earlier"
        >
          ◀
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
          title="Move later"
        >
          ▶
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.removeBtn}`}
          onClick={() => onRemove(index)}
          title="Remove image"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ImageToPdfTool() {
  const meta = getToolMeta('img-image-to-pdf');
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
    <ToolPage title={meta.title} description={meta.description} currentId="img-image-to-pdf">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label="Choose images or drag them here"
          hint="Supports JPG, PNG, WebP, GIF, SVG, BMP, HEIC and more."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{job.error}</div>}

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
                    Images: <strong>{files.length}</strong>
                  </span>
                  <span className="meta-chip">
                    Total size: <strong>{formatBytes(totalInputSize)}</strong>
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
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Add more images
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    Clear all
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
                <ProgressBar value={job.progress} label="Combining images into PDF..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Page size" hint="Fit to image creates pages sized exactly to each image.">
                    <Select
                      id={pageSizeId}
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as PageSizeOption)}
                      options={[
                        { value: 'a4', label: 'A4 (210 × 297 mm)' },
                        { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
                        { value: 'fit', label: 'Fit to image (natural dimensions)' },
                      ]}
                    />
                  </Field>

                  {pageSize !== 'fit' && (
                    <Field label="Page orientation" hint="Auto sets landscape or portrait based on each image's shape.">
                      <Select
                        id={orientationId}
                        value={orientation}
                        onChange={(e) => setOrientation(e.target.value as OrientationOption)}
                        options={[
                          { value: 'auto', label: 'Auto (match image orientation)' },
                          { value: 'portrait', label: 'Portrait' },
                          { value: 'landscape', label: 'Landscape' },
                        ]}
                      />
                    </Field>
                  )}

                  <Field label="Page margins" hint="White margin around images on the page.">
                    <Select
                      id={marginId}
                      value={margin}
                      onChange={(e) => setMargin(e.target.value as MarginOption)}
                      options={[
                        { value: 'none', label: 'None (edge-to-edge)' },
                        { value: 'small', label: 'Small (18 pt / 0.25 in)' },
                        { value: 'large', label: 'Large (36 pt / 0.5 in)' },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different files
                    </Button>
                    <Button variant="primary" onClick={handleConvert}>
                      Create PDF
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
