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
import { imagesToPdf, type PageSizeOption, type MarginOption } from '../_pdf/imageToPdf';
import { PdfPreview } from '../_pdf/PdfPreview';
import styles from './Tool.module.css';

function ScreenshotCard({
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
        <button type="button" className={`${styles.iconBtn} ${styles.removeBtn}`} onClick={() => onRemove(index)} title="Remove screenshot">
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ScreenshotToPdfTool() {
  const meta = getToolMeta('img-screenshot-to-pdf');
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeOption>('fit');
  const [margin, setMargin] = useState<MarginOption>('none');
  const [pageLayoutMode, setPageLayoutMode] = useState<'single' | 'split'>('single');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  const layoutModeId = useId();
  const pageSizeId = useId();
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
        pageSize: pageLayoutMode === 'split' ? 'a4' : pageSize,
        orientation: 'auto',
        margin,
        splitTallScreenshots: pageLayoutMode === 'split',
        onProgress: (cur, tot) => {
          setProgress(tot > 0 ? cur / tot : 0);
        },
      });
    });
  };

  const totalInputSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-screenshot-to-pdf">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label="Choose screenshots or drag them here"
          hint="Supports PNG, JPG, WebP. Tuned for full-page and app screenshots."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <PdfPreview
              blob={job.result}
              filename="screenshots.pdf"
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
                    Screenshots: <strong>{files.length}</strong>
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
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    Add more screenshots
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    Clear all
                  </Button>
                </div>
              </div>

              <div className={styles.thumbnailsGrid}>
                {files.map((file, idx) => (
                  <ScreenshotCard
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
                <ProgressBar value={job.progress} label="Converting screenshots into PDF..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field
                    label="Screenshot page layout"
                    hint="Choose whether tall scrolling captures stay on one seamless page or get split for printing."
                  >
                    <Select
                      id={layoutModeId}
                      value={pageLayoutMode}
                      onChange={(e) => setPageLayoutMode(e.target.value as 'single' | 'split')}
                      options={[
                        {
                          value: 'single',
                          label: 'One long page per screenshot (preserves full scrolling height)',
                        },
                        {
                          value: 'split',
                          label: 'Split tall screenshots across standard A4 pages',
                        },
                      ]}
                    />
                  </Field>

                  {pageLayoutMode === 'single' && (
                    <Field label="Page size" hint="Fit to image sizes each page to the screenshot without borders.">
                      <Select
                        id={pageSizeId}
                        value={pageSize}
                        onChange={(e) => setPageSize(e.target.value as PageSizeOption)}
                        options={[
                          { value: 'fit', label: 'Fit to screenshot (recommended)' },
                          { value: 'a4', label: 'A4 (210 × 297 mm)' },
                          { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
                        ]}
                      />
                    </Field>
                  )}

                  <Field label="Page margins" hint="Screenshots look best with no margins.">
                    <Select
                      id={marginId}
                      value={margin}
                      onChange={(e) => setMargin(e.target.value as MarginOption)}
                      options={[
                        { value: 'none', label: 'None (edge-to-edge - recommended)' },
                        { value: 'small', label: 'Small margin (18 pt / 0.25 in)' },
                        { value: 'large', label: 'Large margin (36 pt / 0.5 in)' },
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
