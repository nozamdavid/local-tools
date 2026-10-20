import { useEffect, useState } from 'react';
import { PDFName } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { CropArea, type Frac } from './CropArea';
import styles from './Tool.module.css';

type Unit = 'mm' | '%';
type Scope = 'all' | 'current';

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const PT_PER_MM = 72 / 25.4;
const ZERO: Margins = { top: 0, right: 0, bottom: 0, left: 0 };
const PREVIEW_SIZE = 900;

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Margin value in the chosen unit to a fraction of the page side (`dim` is in points). */
const toFrac = (v: number, unit: Unit, dim: number) =>
  unit === '%' ? v / 100 : (v * PT_PER_MM) / dim;

const fromFrac = (f: number, unit: Unit, dim: number) =>
  round(unit === '%' ? f * 100 : (f * dim) / PT_PER_MM, 2);

const toPoints = (v: number, unit: Unit, dim: number) =>
  unit === '%' ? (v / 100) * dim : v * PT_PER_MM;

const SIDES: { key: keyof Margins; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'right', label: 'Right' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
];

export default function CropTool() {
  const meta = getToolMeta('pdf-crop');
  const source = usePdfSource();
  const job = useJob();

  const [current, setCurrent] = useState(0);
  const [unit, setUnit] = useState<Unit>('mm');
  const [margins, setMargins] = useState<Margins>(ZERO);
  const [scope, setScope] = useState<Scope>('all');
  const [preview, setPreview] = useState<string | null>(null);

  const { doc, pages } = source;
  const total = pages.length;
  const page = pages[current];

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setPreview(null);
    renderPdfThumbnail(doc, current + 1, PREVIEW_SIZE)
      .then((url) => {
        if (!cancelled) setPreview(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, current]);

  const frac: Frac = page
    ? {
        l: clamp01(toFrac(margins.left, unit, page.width)),
        r: clamp01(toFrac(margins.right, unit, page.width)),
        t: clamp01(toFrac(margins.top, unit, page.height)),
        b: clamp01(toFrac(margins.bottom, unit, page.height)),
      }
    : { l: 0, r: 0, t: 0, b: 0 };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setCurrent(0);
    setMargins(ZERO);
    setScope('all');
    job.reset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    setCurrent(0);
    setMargins(ZERO);
    job.reset();
  };

  const handleDrag = (f: Frac) => {
    if (!page) return;
    setMargins({
      left: fromFrac(f.l, unit, page.width),
      right: fromFrac(f.r, unit, page.width),
      top: fromFrac(f.t, unit, page.height),
      bottom: fromFrac(f.b, unit, page.height),
    });
  };

  const handleUnit = (next: Unit) => {
    if (!page || next === unit) return;
    setMargins({
      left: fromFrac(toFrac(margins.left, unit, page.width), next, page.width),
      right: fromFrac(toFrac(margins.right, unit, page.width), next, page.width),
      top: fromFrac(toFrac(margins.top, unit, page.height), next, page.height),
      bottom: fromFrac(toFrac(margins.bottom, unit, page.height), next, page.height),
    });
    setUnit(next);
  };

  const hasCrop = Object.values(margins).some((v) => v > 0);

  const handleCrop = () => {
    if (!doc || !hasCrop) return;
    const m = margins;
    const u = unit;
    const targets = scope === 'all' ? pages.map((_, i) => i) : [current];

    job.run(async (setProgress) => {
      const pdf = await source.loadForEditing();
      const pdfPages = pdf.getPages();

      for (let n = 0; n < targets.length; n++) {
        const index = targets[n];
        const target = pdfPages[index];
        if (!target) continue;

        // pdf.js knows the visible page box and rotation; its viewport maps visual
        // coordinates (top-left origin, y down) back to PDF user space.
        const jsPage = await doc.getPage(index + 1);
        const viewport = jsPage.getViewport({ scale: 1 });
        jsPage.cleanup();

        const w = viewport.width;
        const h = viewport.height;
        const x0 = toPoints(m.left, u, w);
        const y0 = toPoints(m.top, u, h);
        const x1 = w - toPoints(m.right, u, w);
        const y1 = h - toPoints(m.bottom, u, h);
        if (x1 - x0 < 1 || y1 - y0 < 1) {
          throw new Error(`The crop area leaves nothing of page ${index + 1}.`);
        }

        const [ax, ay] = viewport.convertToPdfPoint(x0, y0) as [number, number];
        const [bx, by] = viewport.convertToPdfPoint(x1, y1) as [number, number];
        const left = round(Math.min(ax, bx), 3);
        const bottom = round(Math.min(ay, by), 3);
        const width = round(Math.abs(bx - ax), 3);
        const height = round(Math.abs(by - ay), 3);

        target.setCropBox(left, bottom, width, height);
        target.setMediaBox(left, bottom, width, height);
        for (const name of ['TrimBox', 'BleedBox', 'ArtBox']) {
          target.node.delete(PDFName.of(name));
        }

        setProgress((n + 1) / targets.length);
      }

      const bytes = await pdf.save();
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-cropped.pdf` : 'cropped.pdf';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && (
        <PasswordDialog
          reason={source.password.reason}
          onSubmit={source.password.submit}
          onCancel={handleReset}
        />
      )}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Crop pages without re-rendering them. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{source.error}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.result ? (
            <PdfPreview
              blob={job.result}
              filename={outName}
              pageCount={total}
              onReset={handleReset}
            />
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
                  {doc && (
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

              {doc && page && (
                <div className={styles.layout}>
                  <div className={styles.previewCol}>
                    <div className={styles.pager}>
                      <Button
                        variant="secondary"
                        onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                        disabled={current === 0}
                        aria-label="Previous page"
                      >
                        ◀
                      </Button>
                      <span data-testid="page-indicator">
                        Page {current + 1} of {total}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
                        disabled={current === total - 1}
                        aria-label="Next page"
                      >
                        ▶
                      </Button>
                    </div>

                    <CropArea
                      src={preview}
                      aspect={page.width / page.height}
                      frac={frac}
                      onChange={handleDrag}
                    />
                    <p className={styles.hint}>
                      Drag on the page to draw the crop area, then fine-tune it with the handles or the
                      margin fields.
                    </p>
                  </div>

                  <div className={styles.controlsCol}>
                    <Field label="Margins to remove" hint={`Measured from each page edge. This page is ${round(page.width / PT_PER_MM, 1)} × ${round(page.height / PT_PER_MM, 1)} mm.`}>
                      <div className={styles.marginGrid}>
                        {SIDES.map(({ key, label }) => (
                          <label key={key} className={styles.marginField}>
                            <span>{label}</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              aria-label={`${label} margin`}
                              value={margins[key]}
                              onChange={(e) =>
                                setMargins((prev) => ({
                                  ...prev,
                                  [key]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </Field>

                    <Field label="Unit">
                      <Select
                        aria-label="Unit"
                        value={unit}
                        onChange={(e) => handleUnit(e.target.value as Unit)}
                        options={[
                          { value: 'mm', label: 'Millimetres (mm)' },
                          { value: '%', label: 'Percent of page (%)' },
                        ]}
                      />
                    </Field>

                    <Field label="Apply to" hint="With several page sizes, millimetre margins stay the same and percent margins scale with each page.">
                      <div className={styles.scope} role="radiogroup" aria-label="Pages to crop">
                        <label>
                          <input
                            type="radio"
                            name="scope"
                            checked={scope === 'all'}
                            onChange={() => setScope('all')}
                          />
                          All pages
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="scope"
                            checked={scope === 'current'}
                            onChange={() => setScope('current')}
                          />
                          Current page only
                        </label>
                      </div>
                    </Field>

                    <Button variant="secondary" onClick={() => setMargins(ZERO)} disabled={!hasCrop}>
                      Clear crop area
                    </Button>
                  </div>
                </div>
              )}

              {doc && page && (
                job.status === 'running' ? (
                  <ProgressBar value={job.progress} label="Cropping pages…" />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleCrop} disabled={!hasCrop}>
                      Crop {scope === 'all' ? `${total} ${total === 1 ? 'page' : 'pages'}` : 'this page'}
                    </Button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
