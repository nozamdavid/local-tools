import { useState } from 'react';
import { degrees, StandardFonts } from 'pdf-lib';
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
import { getVisualPageDims, mapVisualToPdf, hexToRgb } from '../_stamp/coords';
import { getTargetPages } from '../_stamp/pageScope';
import styles from './Tool.module.css';

type Position = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

const POSITIONS = [
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'top-left', label: 'Top Left' },
];

const FORMATS = [
  { value: '{n}', label: 'Number only (1, 2, ...)' },
  { value: 'Page {n}', label: 'Page 1, Page 2, ...' },
  { value: 'Page {n} of {total}', label: 'Page 1 of 10' },
  { value: '{n} / {total}', label: '1 / 10' },
];

export default function PageNumbersTool() {
  const meta = getToolMeta('pdf-page-numbers');
  const source = usePdfSource();
  const job = useJob();

  const [position, setPosition] = useState<Position>('bottom-center');
  const [format, setFormat] = useState('{n}');
  const [startNumber, setStartNumber] = useState(1);
  const [fontSize, setFontSize] = useState(12);
  const [margin, setMargin] = useState(30);
  const [color, setColor] = useState('#000000');
  const [scope, setScope] = useState<'all' | 'range'>('all');
  const [rangeStr, setRangeStr] = useState('');
  const [excludeFirst, setExcludeFirst] = useState(false);

  const total = source.pages.length;

  const targetPages = getTargetPages(scope, total, {
    rangeStr,
    excludeFirst,
  });

  const targetSet = new Set(targetPages);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
  };

  const handleApply = () => {
    if (targetPages.length === 0) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pages = pdf.getPages();
      const totalDocPages = pages.length;

      setProgress(0.3);

      let countIndex = 0;
      for (let pNum = 1; pNum <= totalDocPages; pNum++) {
        if (!targetSet.has(pNum)) continue;

        const page = pages[pNum - 1];
        const dims = getVisualPageDims(page);
        const currentNum = startNumber + countIndex;
        countIndex++;

        const text = format
          .replace('{n}', String(currentNum))
          .replace('{total}', String(targetPages.length));

        const textWidth = font.widthOfTextAtSize(text, fontSize);

        // Visual position coordinates (origin visual bottom-left)
        let xv = 0;
        let yv = 0;

        switch (position) {
          case 'bottom-center':
            xv = (dims.visualWidth - textWidth) / 2;
            yv = margin;
            break;
          case 'bottom-left':
            xv = margin;
            yv = margin;
            break;
          case 'bottom-right':
            xv = dims.visualWidth - margin - textWidth;
            yv = margin;
            break;
          case 'top-center':
            xv = (dims.visualWidth - textWidth) / 2;
            yv = dims.visualHeight - margin - fontSize;
            break;
          case 'top-left':
            xv = margin;
            yv = dims.visualHeight - margin - fontSize;
            break;
          case 'top-right':
            xv = dims.visualWidth - margin - textWidth;
            yv = dims.visualHeight - margin - fontSize;
            break;
        }

        const placement = mapVisualToPdf({ x: xv, y: yv, angle: 0 }, dims);

        page.drawText(text, {
          x: placement.x,
          y: placement.y,
          size: fontSize,
          font,
          color: hexToRgb(color),
          rotate: degrees(placement.rotateDegrees),
        });
      }

      setProgress(0.8);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-numbered.pdf` : 'numbered.pdf';

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
          hint="Add customizable page numbers to your PDF pages."
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
                    <Field label="Position">
                      <Select
                        value={position}
                        onChange={(e) => setPosition(e.target.value as Position)}
                        options={POSITIONS}
                      />
                    </Field>

                    <Field label="Format">
                      <Select
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                        options={FORMATS}
                      />
                    </Field>

                    <Field label="Start Number" hint="First page number to display">
                      <input
                        type="number"
                        className={styles.textInput}
                        min={1}
                        value={startNumber}
                        onChange={(e) => setStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                    </Field>

                    <Field label="Font Size (pt)">
                      <input
                        type="number"
                        className={styles.textInput}
                        min={8}
                        max={72}
                        value={fontSize}
                        onChange={(e) => setFontSize(Math.max(6, parseInt(e.target.value) || 12))}
                      />
                    </Field>

                    <Field label="Margin from edge (pt)">
                      <input
                        type="number"
                        className={styles.textInput}
                        min={10}
                        max={100}
                        value={margin}
                        onChange={(e) => setMargin(Math.max(5, parseInt(e.target.value) || 30))}
                      />
                    </Field>

                    <Field label="Text Color">
                      <input
                        type="color"
                        style={{ width: '100%', height: '42px', padding: '2px', borderRadius: '4px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', cursor: 'pointer' }}
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                      />
                    </Field>

                    <Field label="Page Scope">
                      <div className={styles.scope} role="radiogroup" aria-label="Page scope">
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
                            checked={scope === 'range'}
                            onChange={() => setScope('range')}
                          />
                          Page range
                        </label>
                      </div>

                      {scope === 'range' && (
                        <input
                          type="text"
                          className={styles.textInput}
                          style={{ marginTop: '0.5rem' }}
                          placeholder="e.g. 1-3, 5, 7-9"
                          value={rangeStr}
                          onChange={(e) => setRangeStr(e.target.value)}
                        />
                      )}

                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={excludeFirst}
                          onChange={(e) => setExcludeFirst(e.target.checked)}
                        />
                        Skip first page (cover page)
                      </label>
                    </Field>
                  </div>

                  <div className={styles.previewGrid}>
                    {source.pages.map((page, index) => {
                      const pNum = index + 1;
                      const isNumbered = targetSet.has(pNum);
                      let targetIndex = -1;
                      if (isNumbered) {
                        targetIndex = targetPages.indexOf(pNum);
                      }
                      const previewNumber = isNumbered ? startNumber + targetIndex : null;

                      return (
                        <div
                          key={index}
                          className={`${styles.pageCard} ${isNumbered ? styles.pageCardNumbered : ''}`}
                        >
                          {isNumbered && (
                            <span className={styles.pageBadge}>
                              #{previewNumber}
                            </span>
                          )}
                          <PageThumb
                            src={source.thumbs[index]}
                            width={page.width}
                            height={page.height}
                            alt={`Page ${pNum}`}
                          />
                          <span className={styles.pageLabel}>Page {pNum}</span>
                        </div>
                      );
                    })}
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Adding page numbers…" />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleApply}
                        disabled={targetPages.length === 0}
                      >
                        Add numbers to {targetPages.length} {targetPages.length === 1 ? 'page' : 'pages'}
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
