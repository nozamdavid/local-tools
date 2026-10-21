import { useState, useEffect, useMemo } from 'react';
import { diffLines, createTwoFilesPatch, type Change } from 'diff';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { takePendingFiles } from '../../../lib/handoff';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { PageThumb } from '../_thumbs/PageThumb';
import { extractPdfText, type ExtractionResult } from '../_ai';
import { createSyntheticComparePdfs } from '../_ai/synthetic';
import styles from './Tool.module.css';

type CompareTab = 'visual' | 'text' | 'export';

interface PageAlignment {
  pageIndex: number;
  hasInA: boolean;
  hasInB: boolean;
  status: 'matched' | 'deleted' | 'inserted';
  label: string;
}

export default function CompareTool() {
  const meta = getToolMeta('pdf-compare');
  const sourceA = usePdfSource(220);
  const sourceB = usePdfSource(220);

  const [activeTab, setActiveTab] = useState<CompareTab>('visual');
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [sliderPos, setSliderPos] = useState<number>(50); // 0 = Doc A, 100 = Doc B
  const [blendMode, setBlendMode] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1.0);

  const [extractA, setExtractA] = useState<ExtractionResult | null>(null);
  const [extractB, setExtractB] = useState<ExtractionResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Deliver handed pending PDF pair or single PDF from home page
  useEffect(() => {
    const handed = takePendingFiles(meta.path || '/pdf/compare', 'application/pdf,.pdf', true);
    if (handed && handed.accepted.length > 0) {
      if (handed.accepted[0]) {
        sourceA.open(handed.accepted[0]);
      }
      if (handed.accepted[1]) {
        sourceB.open(handed.accepted[1]);
      }
    }
  }, []);

  // Extract text when docA is available
  useEffect(() => {
    if (sourceA.doc && !extractA) {
      extractPdfText(sourceA.doc)
        .then(setExtractA)
        .catch(() => {});
    }
  }, [sourceA.doc, extractA]);

  // Extract text when docB is available
  useEffect(() => {
    if (sourceB.doc && !extractB) {
      extractPdfText(sourceB.doc)
        .then(setExtractB)
        .catch(() => {});
    }
  }, [sourceB.doc, extractB]);

  const handleReset = () => {
    sourceA.reset();
    sourceB.reset();
    setExtractA(null);
    setExtractB(null);
    setSelectedPageIndex(0);
    setSliderPos(50);
    setBlendMode(false);
    setScale(1.0);
    setCopied(false);
  };

  const handleLoadSample = async () => {
    handleReset();
    const { fileA, fileB } = await createSyntheticComparePdfs();
    await sourceA.open(fileA);
    await sourceB.open(fileB);
  };

  const bothLoaded = Boolean(sourceA.file && sourceB.file && sourceA.doc && sourceB.doc);

  // Compute page alignment
  const pageAlignments: PageAlignment[] = useMemo(() => {
    const countA = sourceA.pages.length;
    const countB = sourceB.pages.length;
    const total = Math.max(countA, countB);
    const list: PageAlignment[] = [];

    for (let i = 0; i < total; i++) {
      const hasInA = i < countA;
      const hasInB = i < countB;

      let status: 'matched' | 'deleted' | 'inserted' = 'matched';
      let label = `Page ${i + 1}`;

      if (hasInA && !hasInB) {
        status = 'deleted';
        label = `Page ${i + 1} (Deleted in B)`;
      } else if (!hasInA && hasInB) {
        status = 'inserted';
        label = `Page ${i + 1} (Inserted in B)`;
      }

      list.push({ pageIndex: i, hasInA, hasInB, status, label });
    }

    return list;
  }, [sourceA.pages.length, sourceB.pages.length]);

  // Compute diffs for full document and selected page
  const textDiffFull = useMemo<Change[]>(() => {
    if (!extractA || !extractB) return [];
    const textA = extractA.pages.map((p) => `--- Page ${p.pageNum} ---\n` + p.rawText).join('\n\n');
    const textB = extractB.pages.map((p) => `--- Page ${p.pageNum} ---\n` + p.rawText).join('\n\n');
    return diffLines(textA, textB);
  }, [extractA, extractB]);

  const textDiffPage = useMemo<Change[]>(() => {
    if (!extractA || !extractB) return [];
    const pageA = extractA.pages[selectedPageIndex]?.rawText ?? '';
    const pageB = extractB.pages[selectedPageIndex]?.rawText ?? '';
    return diffLines(pageA, pageB);
  }, [extractA, extractB, selectedPageIndex]);

  // Plain text export report using createTwoFilesPatch
  const exportReport = useMemo<string>(() => {
    if (!sourceA.file || !sourceB.file || !extractA || !extractB) return '';
    const nameA = sourceA.file.name;
    const nameB = sourceB.file.name;
    const textA = extractA.pages.map((p) => `--- Page ${p.pageNum} ---\n` + p.rawText).join('\n\n');
    const textB = extractB.pages.map((p) => `--- Page ${p.pageNum} ---\n` + p.rawText).join('\n\n');

    const header = [
      '===================================================================',
      `PDF COMPARISON REPORT: ${nameA} vs ${nameB}`,
      `Date: ${new Date().toLocaleString()}`,
      `Document A: ${nameA} (${sourceA.pages.length} pages, ${formatBytes(sourceA.file.size)})`,
      `Document B: ${nameB} (${sourceB.pages.length} pages, ${formatBytes(sourceB.file.size)})`,
      '===================================================================',
      '',
      '--- PAGE ALIGNMENT ---',
      ...pageAlignments.map((pa) => `  [${pa.label}] Status: ${pa.status.toUpperCase()}`),
      '',
      '--- TEXT UNIFIED PATCH DIFF ---',
      '',
    ].join('\n');

    const patch = createTwoFilesPatch(nameA, nameB, textA, textB, 'Document A', 'Document B');
    return header + patch;
  }, [sourceA.file, sourceB.file, sourceA.pages.length, sourceB.pages.length, extractA, extractB, pageAlignments]);

  const handleCopyReport = async () => {
    if (!exportReport) return;
    try {
      await navigator.clipboard.writeText(exportReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownloadReport = () => {
    if (!exportReport || !sourceA.file || !sourceB.file) return;
    const nameA = sourceA.file.name.replace(/\.[^/.]+$/, '');
    const nameB = sourceB.file.name.replace(/\.[^/.]+$/, '');
    downloadBlob(new Blob([exportReport], { type: 'text/plain;charset=utf-8' }), `compare-${nameA}-vs-${nameB}.txt`);
  };

  const activePageInfo = pageAlignments[selectedPageIndex] ?? pageAlignments[0];
  const thumbA = sourceA.thumbs[selectedPageIndex];
  const thumbB = sourceB.thumbs[selectedPageIndex];

  // Count added, deleted lines
  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const part of textDiffFull) {
      const count = part.count || part.value.split('\n').filter(Boolean).length;
      if (part.added) added += count;
      else if (part.removed) removed += count;
      else unchanged += count;
    }
    return { added, removed, unchanged };
  }, [textDiffFull]);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {sourceA.password && <PasswordDialog reason={sourceA.password.reason} onSubmit={sourceA.password.submit} onCancel={handleReset} />}
      {sourceB.password && <PasswordDialog reason={sourceB.password.reason} onSubmit={sourceB.password.submit} onCancel={handleReset} />}

      {!bothLoaded ? (
        <div>
          <div className={styles.uploadGrid}>
            <div className={styles.uploadCard}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Document A (Original)</span>
                {sourceA.file && <span className="badge badge-success">{formatBytes(sourceA.file.size)}</span>}
              </div>
              {!sourceA.file ? (
                <FileDrop
                  accept="application/pdf,.pdf"
                  multiple={true}
                  label="Drop Document A (Base PDF)"
                  hint="First document to compare against."
                  onFiles={(files) => {
                    if (files[0]) sourceA.open(files[0]);
                    if (files[1] && !sourceB.file) sourceB.open(files[1]);
                  }}
                />
              ) : (
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{sourceA.file.name}</strong>
                  </span>
                  {sourceA.pages.length > 0 && (
                    <span className="meta-chip">
                      Pages: <strong>{sourceA.pages.length}</strong>
                    </span>
                  )}
                  <Button variant="secondary" onClick={() => sourceA.reset()}>
                    Change
                  </Button>
                </div>
              )}
            </div>

            <div className={styles.uploadCard}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Document B (Comparison)</span>
                {sourceB.file && <span className="badge badge-success">{formatBytes(sourceB.file.size)}</span>}
              </div>
              {!sourceB.file ? (
                <FileDrop
                  accept="application/pdf,.pdf"
                  label="Drop Document B (New PDF)"
                  hint="Second document to compare with Document A."
                  onFiles={(files) => files[0] && sourceB.open(files[0])}
                />
              ) : (
                <div className="meta-chips">
                  <span className="meta-chip">
                    File: <strong>{sourceB.file.name}</strong>
                  </span>
                  {sourceB.pages.length > 0 && (
                    <span className="meta-chip">
                      Pages: <strong>{sourceB.pages.length}</strong>
                    </span>
                  )}
                  <Button variant="secondary" onClick={() => sourceB.reset()}>
                    Change
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className={styles.sampleBtnRow}>
            <Button variant="secondary" onClick={handleLoadSample}>
              Load Sample Comparison PDFs
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                Doc A: <strong>{sourceA.file?.name}</strong> ({sourceA.pages.length} p)
              </span>
              <span className="meta-chip">
                Doc B: <strong>{sourceB.file?.name}</strong> ({sourceB.pages.length} p)
              </span>
              <span className="badge badge-success">+{diffStats.added} lines</span>
              <span className="badge badge-danger" style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
                -{diffStats.removed} lines
              </span>
            </div>
            <Button variant="secondary" onClick={handleReset}>
              Change Documents
            </Button>
          </div>

          {/* Navigation Tabs */}
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'visual' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('visual')}
            >
              Visual Page Comparison
            </button>
            <button className={`${styles.tabBtn} ${activeTab === 'text' ? styles.tabBtnActive : ''}`} onClick={() => setActiveTab('text')}>
              Text Differences
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'export' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('export')}
            >
              Export Comparison (.txt)
            </button>
          </div>

          {/* Page Carousel / Strip */}
          <div className={styles.pageStrip}>
            {pageAlignments.map((align, idx) => {
              const pA = sourceA.pages[idx];
              const pB = sourceB.pages[idx];
              const w = pA?.width || pB?.width || 150;
              const h = pA?.height || pB?.height || 200;

              return (
                <div
                  key={idx}
                  className={`${styles.pageThumbCard} ${idx === selectedPageIndex ? styles.pageThumbCardActive : ''}`}
                  onClick={() => setSelectedPageIndex(idx)}
                >
                  <PageThumb src={sourceA.thumbs[idx] || sourceB.thumbs[idx]} width={w} height={h} alt={`Page ${idx + 1}`} />
                  <span
                    className={`${styles.pageBadge} ${
                      align.status === 'deleted'
                        ? styles.badgeDeleted
                        : align.status === 'inserted'
                          ? styles.badgeInserted
                          : styles.badgeNormal
                    }`}
                  >
                    {align.status === 'deleted' ? 'Deleted' : align.status === 'inserted' ? 'Inserted' : `Page ${idx + 1}`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Tab 1: Visual Compare */}
          {activeTab === 'visual' && (
            <div className={styles.visualCompareBox}>
              <div className={styles.sliderBar}>
                <span>
                  <strong>Document A (0%)</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderPos}
                  onChange={(e) => setSliderPos(Number(e.target.value))}
                  className={styles.sliderInput}
                  aria-label="Comparison slider"
                />
                <span>
                  <strong>Document B (100%)</strong>
                </span>
                <span className="badge badge-normal" style={{ minWidth: 45, textAlign: 'center' }}>
                  {sliderPos}%
                </span>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto', cursor: 'pointer' }}>
                  <input type="checkbox" checked={blendMode} onChange={(e) => setBlendMode(e.target.checked)} />
                  Difference Blend Mode
                </label>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label htmlFor="zoom-scale">Zoom:</label>
                  <select
                    id="zoom-scale"
                    value={String(scale)}
                    onChange={(e) => setScale(Number(e.target.value))}
                    style={{ padding: '0.2rem 0.4rem', borderRadius: 4 }}
                  >
                    <option value="1.0">1.0x (Normal)</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x (Max)</option>
                  </select>
                </div>
              </div>

              {activePageInfo?.status === 'deleted' && (
                <div className="error-banner" style={{ marginBottom: '1rem' }}>
                  ⚠️ This page exists in Document A but was <strong>removed / deleted in Document B</strong>.
                </div>
              )}
              {activePageInfo?.status === 'inserted' && (
                <div className="badge badge-success" style={{ marginBottom: '1rem', display: 'inline-block' }}>
                  ✨ This page is a <strong>newly inserted page in Document B</strong> (not present in Document A).
                </div>
              )}

              <div className={styles.visualStageContainer}>
                {thumbA && (
                  <img
                    src={thumbA}
                    alt="Document A Page"
                    className={styles.visualLayer}
                    style={{
                      opacity: blendMode ? 1 : 1 - sliderPos / 100,
                      transform: `translate(-50%, -50%) scale(${scale})`,
                    }}
                  />
                )}
                {thumbB && (
                  <img
                    src={thumbB}
                    alt="Document B Page"
                    className={styles.visualLayer}
                    style={{
                      opacity: blendMode ? 1 : sliderPos / 100,
                      mixBlendMode: blendMode ? 'difference' : 'normal',
                      transform: `translate(-50%, -50%) scale(${scale})`,
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Text Differences */}
          {activeTab === 'text' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0 }}>Differences on Page {selectedPageIndex + 1}</h4>
                <div className="meta-chips">
                  <span className="badge badge-success">+{textDiffPage.filter((p) => p.added).length} added</span>
                  <span className="badge badge-danger" style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}>
                    -{textDiffPage.filter((p) => p.removed).length} removed
                  </span>
                </div>
              </div>

              <div className={styles.diffTextContainer}>
                {textDiffPage.map((part, index) => {
                  const className = part.added ? styles.diffLineAdd : part.removed ? styles.diffLineDel : styles.diffLineSame;
                  const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';

                  return (
                    <div key={index} className={className}>
                      {part.value
                        .split('\n')
                        .filter((line, i, arr) => line || i < arr.length - 1)
                        .map((line, lIdx) => (
                          <div key={lIdx}>
                            {prefix}
                            {line}
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 3: Export Comparison */}
          {activeTab === 'export' && (
            <div>
              <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Full Document Comparison Report</h4>
              <textarea className={styles.exportTextarea} value={exportReport} readOnly aria-label="Exported comparison report" />
              <div className="action-buttons" style={{ marginTop: '1rem' }}>
                <Button variant="secondary" onClick={handleCopyReport}>
                  {copied ? 'Copied!' : 'Copy Report'}
                </Button>
                <Button variant="primary" onClick={handleDownloadReport}>
                  Download Comparison (.txt)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
