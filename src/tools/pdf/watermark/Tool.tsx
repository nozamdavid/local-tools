import { useState, useRef } from 'react';
import { degrees, StandardFonts } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Field, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { getVisualPageDims, mapVisualToPdf, calcRotatedCenterVisualOrigin, hexToRgb } from '../_stamp/coords';
import { getTargetPages } from '../_stamp/pageScope';
import styles from './Tool.module.css';

type WatermarkType = 'text' | 'image';
type Scope = 'all' | 'range' | 'selected';

export default function WatermarkTool() {
  const meta = getToolMeta('pdf-watermark');
  const source = usePdfSource();
  const job = useJob();

  const [type, setType] = useState<WatermarkType>('text');

  // Text watermark options
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState('#888888');

  // Image watermark options
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(50); // percentage of page width

  // Shared watermark options
  const [opacity, setOpacity] = useState(0.3);
  const [rotation, setRotation] = useState(-45);
  const [scope, setScope] = useState<Scope>('all');
  const [rangeStr, setRangeStr] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const total = source.pages.length;

  const targetPages = scope === 'selected' ? Array.from(selected).sort((a, b) => a - b) : getTargetPages(scope, total, { rangeStr });

  const targetSet = new Set(targetPages);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setSelected(new Set());
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
    setSelected(new Set());
  };

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  };

  const togglePage = (pNum: number) => {
    if (scope !== 'selected') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pNum)) next.delete(pNum);
      else next.add(pNum);
      return next;
    });
  };

  const handleApply = () => {
    if (targetPages.length === 0) return;
    if (type === 'image' && !imageFile) return;

    job.run(async (setProgress) => {
      setProgress(0.1);
      const pdf = await source.loadForEditing();
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);
      const pages = pdf.getPages();
      const totalDocPages = pages.length;

      let embeddedImage: any = null;
      if (type === 'image' && imageFile) {
        // Convert image file to PNG bytes using an offscreen canvas to guarantee compatibility
        const imgBitmap = await createImageBitmap(imageFile);
        const canvas = document.createElement('canvas');
        canvas.width = imgBitmap.width;
        canvas.height = imgBitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgBitmap, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const pngBytes = new Uint8Array(await blob.arrayBuffer());
            embeddedImage = await pdf.embedPng(pngBytes);
          }
        }
      }

      setProgress(0.4);

      for (let pNum = 1; pNum <= totalDocPages; pNum++) {
        if (!targetSet.has(pNum)) continue;

        const page = pages[pNum - 1];
        const dims = getVisualPageDims(page);
        const cx = dims.visualWidth / 2;
        const cy = dims.visualHeight / 2;

        if (type === 'text') {
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          const textHeight = fontSize * 0.7; // approximate cap-height

          const origin = calcRotatedCenterVisualOrigin(cx, cy, textWidth, textHeight, rotation);

          const placement = mapVisualToPdf({ x: origin.x, y: origin.y, angle: rotation }, dims);

          page.drawText(text, {
            x: placement.x,
            y: placement.y,
            size: fontSize,
            font,
            color: hexToRgb(textColor),
            opacity,
            rotate: degrees(placement.rotateDegrees),
          });
        } else if (type === 'image' && embeddedImage) {
          const imgWidth = dims.visualWidth * (imageScale / 100);
          const imgHeight = imgWidth * (embeddedImage.height / embeddedImage.width);

          const origin = calcRotatedCenterVisualOrigin(cx, cy, imgWidth, imgHeight, rotation);

          const placement = mapVisualToPdf({ x: origin.x, y: origin.y, angle: rotation }, dims);

          page.drawImage(embeddedImage, {
            x: placement.x,
            y: placement.y,
            width: imgWidth,
            height: imgHeight,
            opacity,
            rotate: degrees(placement.rotateDegrees),
          });
        }
      }

      setProgress(0.85);
      const bytes = await pdf.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-watermarked.pdf` : 'watermarked.pdf';

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Stamp a customizable text or image watermark over your PDF pages."
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
                  <div style={{ marginTop: '1.25rem' }}>
                    <div className={styles.tabGroup}>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${type === 'text' ? styles.tabBtnActive : ''}`}
                        onClick={() => setType('text')}
                      >
                        Text watermark
                      </button>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${type === 'image' ? styles.tabBtnActive : ''}`}
                        onClick={() => setType('image')}
                      >
                        Image watermark
                      </button>
                    </div>

                    <div className={styles.controls}>
                      {type === 'text' ? (
                        <>
                          <Field label="Watermark Text">
                            <input
                              type="text"
                              className={styles.textInput}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              placeholder="e.g. CONFIDENTIAL, DRAFT"
                            />
                          </Field>

                          <Field label="Font Size (pt)">
                            <Slider value={fontSize} min={12} max={120} step={2} unit="pt" onChange={setFontSize} />
                          </Field>

                          <Field label="Text Color">
                            <input
                              type="color"
                              style={{
                                width: '100%',
                                height: '42px',
                                padding: '2px',
                                borderRadius: '4px',
                                border: '1px solid var(--input-border)',
                                background: 'var(--input-bg)',
                                cursor: 'pointer',
                              }}
                              value={textColor}
                              onChange={(e) => setTextColor(e.target.value)}
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field label="Watermark Image">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleImageSelect(f);
                              }}
                            />
                            {!imagePreview ? (
                              <div className={styles.imageDropArea} onClick={() => fileInputRef.current?.click()}>
                                <span>Click to select an image (PNG / JPG)</span>
                              </div>
                            ) : (
                              <div className={styles.imagePreviewWrapper}>
                                <img src={imagePreview} alt="Watermark preview" className={styles.imagePreviewThumb} />
                                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                                  Change image
                                </Button>
                              </div>
                            )}
                          </Field>

                          <Field label="Image Scale (% of page width)">
                            <Slider value={imageScale} min={10} max={100} step={5} unit="%" onChange={setImageScale} />
                          </Field>
                        </>
                      )}

                      <Field label="Opacity">
                        <Slider
                          value={Math.round(opacity * 100)}
                          min={5}
                          max={100}
                          step={5}
                          unit="%"
                          onChange={(v) => setOpacity(v / 100)}
                        />
                      </Field>

                      <Field label="Rotation">
                        <Slider value={rotation} min={-180} max={180} step={5} unit="°" onChange={setRotation} />
                        <div className={styles.quickAngles}>
                          {[-45, 0, 45, 90].map((deg) => (
                            <button key={deg} type="button" className={styles.angleBtn} onClick={() => setRotation(deg)}>
                              {deg}°
                            </button>
                          ))}
                        </div>
                      </Field>

                      <Field label="Page Scope">
                        <div className={styles.scope} role="radiogroup" aria-label="Pages to watermark">
                          <label>
                            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                            All pages
                          </label>
                          <label>
                            <input type="radio" name="scope" checked={scope === 'range'} onChange={() => setScope('range')} />
                            Page range
                          </label>
                          <label>
                            <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />
                            Pick pages
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
                      </Field>
                    </div>
                  </div>

                  {scope === 'selected' && (
                    <div className={styles.selectRow}>
                      <span className={styles.selectCount}>
                        {selected.size} of {total} selected
                      </span>
                      <Button variant="secondary" onClick={() => setSelected(new Set(Array.from({ length: total }, (_, i) => i + 1)))}>
                        Select all
                      </Button>
                      <Button variant="secondary" onClick={() => setSelected(new Set())}>
                        Deselect all
                      </Button>
                    </div>
                  )}

                  <div className={styles.pageGrid}>
                    {source.pages.map((page, index) => {
                      const pNum = index + 1;
                      const isTarget = targetSet.has(pNum);
                      const clickable = scope === 'selected';

                      return (
                        <div
                          key={index}
                          className={`${styles.pageCard} ${isTarget && clickable ? styles.pageCardSelected : ''} ${clickable ? styles.pageCardClickable : ''}`}
                          onClick={() => togglePage(pNum)}
                        >
                          {clickable && (
                            <input
                              type="checkbox"
                              className={styles.pageCheckbox}
                              checked={isTarget}
                              aria-label={`Select page ${pNum}`}
                              onChange={() => togglePage(pNum)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <PageThumb src={source.thumbs[index]} width={page.width} height={page.height} alt={`Page ${pNum}`} />
                          <span className={styles.pageLabel}>Page {pNum}</span>
                        </div>
                      );
                    })}
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Applying watermark…" />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleApply}
                        disabled={targetPages.length === 0 || (type === 'image' && !imageFile) || (type === 'text' && !text.trim())}
                      >
                        Apply watermark to {targetPages.length} {targetPages.length === 1 ? 'page' : 'pages'}
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
