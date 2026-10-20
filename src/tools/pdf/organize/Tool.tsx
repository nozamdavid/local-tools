import { useRef, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { PageThumb } from '../_thumbs/PageThumb';
import { usePdfSource, type PageInfo } from '../_thumbs/usePdfSource';
import { cleanDanglingLinks } from '../_pages/pdfPages';
import styles from './Tool.module.css';

interface PageItem {
  id: number;
  /** 0-based index in the source PDF, or null for an inserted blank page. */
  src: number | null;
  /** Extra clockwise rotation in degrees. */
  rot: number;
  /** Visual size in points before the extra rotation. */
  width: number;
  height: number;
}

const normalize = (deg: number) => ((deg % 360) + 360) % 360;

function initialItems(pages: PageInfo[]): PageItem[] {
  return pages.map((p, i) => ({ id: i, src: i, rot: 0, width: p.width, height: p.height }));
}

export default function OrganizeTool() {
  const meta = getToolMeta('pdf-organize');
  const source = usePdfSource();
  const job = useJob();

  const [items, setItems] = useState<PageItem[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const nextId = useRef(0);

  const ready = source.doc && items;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setItems(null);
    job.reset();
    await source.open(files[0]);
  };

  // Seed the editable list once the source pages are known.
  if (source.doc && !items && source.pages.length > 0) {
    nextId.current = source.pages.length;
    setItems(initialItems(source.pages));
  }

  const handleReset = () => {
    source.reset();
    setItems(null);
    job.reset();
  };

  const update = (fn: (list: PageItem[]) => PageItem[]) =>
    setItems((prev) => (prev ? fn(prev) : prev));

  const move = (from: number, to: number) =>
    update((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const rotate = (index: number, delta: number) =>
    update((list) =>
      list.map((it, i) => (i === index ? { ...it, rot: normalize(it.rot + delta) } : it)),
    );

  const remove = (index: number) => update((list) => list.filter((_, i) => i !== index));

  const insertBlank = (index: number) =>
    update((list) => {
      const after = list[index];
      const turned = after.rot % 180 !== 0;
      const blank: PageItem = {
        id: nextId.current++,
        src: null,
        rot: 0,
        width: turned ? after.height : after.width,
        height: turned ? after.width : after.height,
      };
      const next = [...list];
      next.splice(index + 1, 0, blank);
      return next;
    });

  const handleKey = (e: React.KeyboardEvent, index: number) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(index, index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(index, index + 1);
    }
  };

  const handleSave = () => {
    if (!items || items.length === 0) return;
    const plan = items;

    job.run(async (setProgress) => {
      const srcDoc = await source.loadForEditing();
      const out = await PDFDocument.create();
      setProgress(0.2);

      const srcIndices = plan.filter((it) => it.src !== null).map((it) => it.src as number);
      cleanDanglingLinks(srcDoc, srcIndices);
      const copied = await out.copyPages(srcDoc, srcIndices);
      const baseRotations = srcIndices.map((i) => srcDoc.getPage(i).getRotation().angle);
      setProgress(0.6);

      let cursor = 0;
      for (const it of plan) {
        if (it.src === null) {
          const page = out.addPage([it.width, it.height]);
          page.setRotation(degrees(it.rot));
        } else {
          const page = copied[cursor];
          page.setRotation(degrees(normalize(baseRotations[cursor] + it.rot)));
          out.addPage(page);
          cursor++;
        }
      }

      setProgress(0.85);
      const bytes = await out.save();
      setProgress(1);
      return new Blob([bytes as BlobPart], { type: 'application/pdf' });
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-organized.pdf` : 'organized.pdf';

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
          hint="Reorder, rotate, delete and insert blank pages."
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
              pageCount={items?.length}
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
                  {items && (
                    <span className="meta-chip">
                      Output pages: <strong>{items.length}</strong>
                    </span>
                  )}
                </div>
                <div className={styles.topActions}>
                  {ready && (
                    <Button
                      variant="secondary"
                      onClick={() => setItems(initialItems(source.pages))}
                    >
                      Undo all changes
                    </Button>
                  )}
                  <Button variant="secondary" onClick={handleReset}>
                    Change PDF
                  </Button>
                </div>
              </div>

              {source.loading && <p className={styles.status}>Opening PDF document…</p>}

              {ready && (
                <>
                  <p className={styles.hint}>
                    Drag pages to reorder them, or focus a page and press Alt + ← / →.
                  </p>

                  <div className={styles.pageGrid}>
                    {items.map((it, index) => (
                      <div
                        key={it.id}
                        tabIndex={0}
                        draggable
                        data-page={it.src === null ? 'blank' : it.src + 1}
                        data-rotation={it.rot}
                        className={`${styles.pageCard} ${dragId === it.id ? styles.dragging : ''} ${overId === it.id && dragId !== it.id ? styles.dropTarget : ''}`}
                        onKeyDown={(e) => handleKey(e, index)}
                        onDragStart={(e) => {
                          setDragId(it.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(it.id));
                        }}
                        onDragOver={(e) => {
                          if (dragId === null) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (overId !== it.id) setOverId(it.id);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = items.findIndex((x) => x.id === dragId);
                          if (from >= 0) move(from, index);
                          setDragId(null);
                          setOverId(null);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                      >
                        <span className={styles.position}>{index + 1}</span>

                        <PageThumb
                          src={it.src === null ? '' : source.thumbs[it.src]}
                          width={it.width}
                          height={it.height}
                          rotation={it.rot}
                          alt={it.src === null ? 'Blank page' : `Page ${it.src + 1}`}
                        />

                        <span className={styles.pageLabel}>
                          {it.src === null ? 'Blank page' : `Page ${it.src + 1}`}
                        </span>

                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            title="Move earlier"
                            aria-label={`Move position ${index + 1} earlier`}
                            disabled={index === 0}
                            onClick={() => move(index, index - 1)}
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            title="Rotate left"
                            aria-label={`Rotate position ${index + 1} left`}
                            onClick={() => rotate(index, -90)}
                          >
                            ↺
                          </button>
                          <button
                            type="button"
                            title="Rotate right"
                            aria-label={`Rotate position ${index + 1} right`}
                            onClick={() => rotate(index, 90)}
                          >
                            ↻
                          </button>
                          <button
                            type="button"
                            title="Insert blank page after"
                            aria-label={`Insert blank page after position ${index + 1}`}
                            onClick={() => insertBlank(index)}
                          >
                            ＋
                          </button>
                          <button
                            type="button"
                            title="Delete page"
                            aria-label={`Delete position ${index + 1}`}
                            onClick={() => remove(index)}
                          >
                            🗑
                          </button>
                          <button
                            type="button"
                            title="Move later"
                            aria-label={`Move position ${index + 1} later`}
                            disabled={index === items.length - 1}
                            onClick={() => move(index, index + 1)}
                          >
                            ▶
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {items.length === 0 && (
                    <p className={styles.status}>All pages were removed. Undo changes to start again.</p>
                  )}

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Building PDF…" />
                  ) : (
                    <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                      <Button variant="secondary" onClick={handleReset}>
                        Choose different file
                      </Button>
                      <Button variant="primary" onClick={handleSave} disabled={items.length === 0}>
                        Save PDF ({items.length} {items.length === 1 ? 'page' : 'pages'})
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
