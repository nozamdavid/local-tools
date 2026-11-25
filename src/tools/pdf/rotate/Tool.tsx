import { useId, useState } from 'react';
import { degrees } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import styles from './Tool.module.css';

type Scope = 'all' | 'selected';

export default function RotateTool() {
  const { t } = useI18n();
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
  const angles = [
    { value: '90', label: t('90° clockwise (right)') },
    { value: '180', label: t('180° (upside down)') },
    { value: '270', label: t('90° counter-clockwise (left)') },
  ];

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
          label={t('Choose a PDF file or drag it here')}
          hint={t('Rotate every page or just the ones you pick.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.result ? (
            <PdfPreview blob={job.result} filename={outName} pageCount={total} onReset={handleReset} />
          ) : (
            <div>
              <div className={styles.topRow}>
                <div className="meta-chips">
                  <span className="meta-chip">
                    {t('File:')} <strong>{file.name}</strong>
                  </span>
                  <span className="meta-chip">
                    {t('Size:')} <strong>{formatBytes(file.size)}</strong>
                  </span>
                  {source.doc && (
                    <span className="meta-chip">
                      {t('Pages:')} <strong>{total}</strong>
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Change PDF')}
                </Button>
              </div>

              {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}

              {source.doc && (
                <>
                  <div className={styles.controls}>
                    <Field label={t('Rotate')}>
                      <Select id={angleId} value={String(angle)} onChange={(e) => setAngle(Number(e.target.value))} options={angles} />
                    </Field>

                    <Field label={t('Pages')} hint={t("Rotation adds to each page's current orientation.")}>
                      <div className={styles.scope} role="radiogroup" aria-label={t('Pages to rotate')}>
                        <label>
                          <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                          {t('All pages')}
                        </label>
                        <label>
                          <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />
                          {t('Selected pages')}
                        </label>
                      </div>
                    </Field>
                  </div>

                  {scope === 'selected' && (
                    <div className={styles.selectRow}>
                      <span className={styles.selectCount}>{t('{selected} of {total} selected', { selected: selected.size, total })}</span>
                      <Button variant="secondary" onClick={() => setSelected(new Set(source.pages.map((_, i) => i)))}>
                        {t('Select all')}
                      </Button>
                      <Button variant="secondary" onClick={() => setSelected(new Set())}>
                        {t('Deselect all')}
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
                              aria-label={t('Select page {number}', { number: index + 1 })}
                              onChange={() => toggle(index)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <PageThumb
                            src={source.thumbs[index]}
                            width={page.width}
                            height={page.height}
                            rotation={on ? angle : 0}
                            alt={t('Page {number}', { number: index + 1 })}
                          />
                          <span className={styles.pageLabel}>{t('Page {number}', { number: index + 1 })}</span>
                        </div>
                      );
                    })}
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label={t('Rotating pages…')} />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        {t('Choose different file')}
                      </Button>
                      <Button variant="primary" onClick={handleRotate} disabled={targetCount === 0}>
                        {t('Rotate {count} {unit}', { count: targetCount, unit: targetCount === 1 ? t('page') : t('pages') })}
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
