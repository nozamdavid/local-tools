import { useId, useState } from 'react';
import { degrees } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import styles from './Tool.module.css';

type Scope = 'all' | 'selected';

const ANGLES = [
  { value: '90', label: '90° clockwise (right)' },
  { value: '180', label: '180° (upside down)' },
  { value: '270', label: '90° counter-clockwise (left)' },
];

export default function RotateTool() {
  const meta = getToolMeta('pdf-rotate');
  const source = usePdfSource();
  const job = useJob();
  const angleId = useId();

  const [scope, setScope] = useState<Scope>('all');
  const [angle, setAngle] = useState(90);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const total = source.pages.length;
  const isTarget = (index: number) => (scope === 'all' ? true : selected.has(index));
  const targetCount = scope === 'all' ? total : selected.size;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setSelected(new Set());
    setScope('all');
    job.reset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    setSelected(new Set());
    job.reset();
  };

  const toggle = (index: number) => {
    if (scope !== 'selected') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleRotate = () => {
    if (targetCount === 0) return;

    job.run(async (setProgress) => {
      const pdf = await source.loadForEditing();
      const pdfPages = pdf.getPages();
      setProgress(0.3);

      pdfPages.forEach((page, index) => {
        if (!isTarget(index)) return;
        const next = (((page.getRotation().angle + angle) % 360) + 360) % 360;
        page.setRotation(degrees(next));
      });

      setProgress(0.7);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-rotated.pdf` : 'rotated.pdf';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Rotate every page or just the ones you pick."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <PdfPreview blob={job.result} filename={outName} pageCount={total} onReset={handleReset} />
          ) : (
            <div>
              <div className={styles.topRow}>
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    Size: <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {source.doc && (
                    <span className="meta-chip">
                      Pages: <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset}>
                  Change PDF
                </Button>
              </div>

              {source.loading && <p className={styles.status}>Opening PDF document…</p>}

              {source.doc && (
                <>
                  <div className={styles.controls}>
                    <Field label="Rotate">
                      <Select id={angleId} value={String(angle)} onChange={(e) => setAngle(Number(e.target.value))} options={ANGLES} />
                    </Field>

                    <Field label="Pages" hint="Rotation adds to each page's current orientation.">
                      <div className={styles.scope} role="radiogroup" aria-label="Pages to rotate">
                        <label>
                          <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                          All pages
                        </label>
                        <label>
                          <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />
                          Selected pages
                        </label>
                      </div>
                    </Field>
                  </div>

                  {scope === 'selected' && (
                    <div className={styles.selectRow}>
                      <span className={styles.selectCount}>
                        {selected.size} of {total} selected
                      </span>
                      <Button variant="secondary" onClick={() => setSelected(new Set(source.pages.map((_, i) => i)))}>
                        Select all
                      </Button>
                      <Button variant="secondary" onClick={() => setSelected(new Set())}>
                        Deselect all
                      </Button>
                    </div>
                  )}

                  <div className={styles.pageGrid}>
                    {source.pages.map((page, index) => {
                      const on = isTarget(index);
                      const clickable = scope === 'selected';
                      return (
                        <div
                          key={index}
                          data-page={index + 1}
                          data-rotated={on ? angle : 0}
                          className={`${styles.pageCard} ${on && clickable ? styles.pageCardSelected : ''} ${clickable ? styles.pageCardClickable : ''}`}
                          onClick={() => toggle(index)}
                        >
                          {clickable && (
                            <input
                              type="checkbox"
                              className={styles.pageCheckbox}
                              checked={on}
                              aria-label={`Select page ${index + 1}`}
                              onChange={() => toggle(index)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <PageThumb
                            src={source.thumbs[index]}
                            width={page.width}
                            height={page.height}
                            rotation={on ? angle : 0}
                            alt={`Page ${index + 1}`}
                          />
                          <span className={styles.pageLabel}>Page {index + 1}</span>
                        </div>
                      );
                    })}
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Rotating pages…" />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button variant="primary" onClick={handleRotate} disabled={targetCount === 0}>
                        Rotate {targetCount} {targetCount === 1 ? 'page' : 'pages'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
