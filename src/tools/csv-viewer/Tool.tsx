import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { parseCsv, serializeCsv, detectDelimiter } from '../_tabular/csv';
import styles from './Tool.module.css';

export default function CsvViewerTool() {
  const meta = getToolMeta('csv-viewer');
  const title = meta.title !== 'csv-viewer' ? meta.title : 'CSV Viewer';
  const description = meta.description || 'View, search, paginate, and inspect CSV/TSV tables safely in your browser.';

  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('paste');
  const [inputText, setInputText] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('table.csv');
  const [delimiterMode, setDelimiterMode] = useState<string>('auto');
  const [hasHeader, setHasHeader] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setSourceName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      setInputText(text);
      setInputTab('paste');
      setCurrentPage(1);
    };
    reader.readAsText(file);
  };

  const detectedDelim = useMemo(() => {
    if (!inputText) return ',';
    return detectDelimiter(inputText);
  }, [inputText]);

  const activeDelimiter = useMemo(() => {
    if (delimiterMode === 'auto') return detectedDelim;
    return delimiterMode;
  }, [delimiterMode, detectedDelim]);

  const allRows = useMemo(() => {
    if (!inputText.trim()) return [];
    try {
      return parseCsv(inputText, { delimiter: activeDelimiter });
    } catch {
      return [];
    }
  }, [inputText, activeDelimiter]);

  const maxCols = useMemo(() => {
    if (allRows.length === 0) return 0;
    return Math.max(...allRows.map((r) => r.length));
  }, [allRows]);

  const headers = useMemo(() => {
    if (allRows.length === 0) return [];
    if (hasHeader) {
      return allRows[0].map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`));
    }
    return Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  }, [allRows, hasHeader, maxCols]);

  const dataRows = useMemo(() => {
    if (allRows.length === 0) return [];
    return hasHeader ? allRows.slice(1) : allRows;
  }, [allRows, hasHeader]);

  // Search filtering
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dataRows;
    return dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
  }, [dataRows, searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const visibleRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  // Copy visible page as TSV
  const handleCopyVisiblePage = async () => {
    if (visibleRows.length === 0 && headers.length === 0) return;
    const lines: string[] = [];
    lines.push(headers.join('\t'));
    for (const row of visibleRows) {
      const padded = Array.from({ length: headers.length }, (_, i) => (i < row.length ? row[i] : ''));
      lines.push(padded.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleDownload = () => {
    if (allRows.length === 0) return;
    const csvContent = serializeCsv(allRows, ',');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, sourceName.endsWith('.csv') ? sourceName : `${sourceName}.csv`);
  };

  const handleReset = () => {
    setInputText('');
    setSearchQuery('');
    setCurrentPage(1);
    setSourceName('table.csv');
  };

  const delimiterName = (d: string) => {
    if (d === ',') return 'Comma (,)';
    if (d === '\t') return 'Tab (\\t)';
    if (d === ';') return 'Semicolon (;)';
    if (d === '|') return 'Pipe (|)';
    return `"${d}"`;
  };

  return (
    <ToolPage title={title} description={description} currentId="csv-viewer">
      <div className={styles.container}>
        <div className={styles.inputCard}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'paste' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('paste')}
            >
              Paste CSV
            </button>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'upload' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('upload')}
            >
              Upload file
            </button>
          </div>

          {inputTab === 'upload' ? (
            <FileDrop
              accept=".csv,.tsv,.txt,text/*"
              label="Choose a CSV, TSV or text file"
              hint="Parsed completely in-memory. Zero network transmission."
              onFiles={handleFiles}
            />
          ) : (
            <Field label="CSV Data" hint="Paste any delimited text or CSV format">
              <textarea
                className={styles.textarea}
                placeholder="id,product,category,price&#10;1,Wireless Mouse,Electronics,29.99&#10;2,Coffee Mug,Kitchen,14.50"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </Field>
          )}

          <div className={styles.controlsRow}>
            <Field label="Delimiter">
              <Select
                value={delimiterMode}
                onChange={(e) => setDelimiterMode(e.target.value)}
                options={[
                  { value: 'auto', label: `Auto-detect (found: ${delimiterName(detectedDelim)})` },
                  { value: ',', label: 'Comma (,)' },
                  { value: '\t', label: 'Tab (\\t)' },
                  { value: ';', label: 'Semicolon (;)' },
                  { value: '|', label: 'Pipe (|)' },
                ]}
              />
            </Field>

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is header
            </label>
          </div>
        </div>

        {allRows.length > 0 && (
          <div className={styles.viewerCard}>
            <div className={styles.viewerHeader}>
              <div className={styles.searchWrap}>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search across all columns..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              <div className={styles.statsBar}>
                <span className={styles.badge}>{dataRows.length} total rows</span>
                {searchQuery && <span className={styles.badge}>{filteredRows.length} filtered rows</span>}
                <span className={styles.badge}>{maxCols} columns</span>
              </div>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '48px', color: 'var(--text-muted)' }}>#</th>
                    {headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rIdx) => {
                    const rowNumber = (safePage - 1) * pageSize + rIdx + 1;
                    return (
                      <tr key={rIdx}>
                        <td style={{ color: 'var(--text-muted)' }}>{rowNumber}</td>
                        {headers.map((_, cIdx) => (
                          <td key={cIdx}>{cIdx < row.length ? row[cIdx] : ''}</td>
                        ))}
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={headers.length + 1} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No rows match &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <div className={styles.pageControls}>
                <button type="button" className={styles.pageBtn} onClick={() => setCurrentPage(1)} disabled={safePage <= 1}>
                  « First
                </button>
                <button
                  type="button"
                  className={styles.pageBtn}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  ‹ Prev
                </button>
                <span className={styles.pageInfo}>
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  Next ›
                </button>
                <button
                  type="button"
                  className={styles.pageBtn}
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safePage >= totalPages}
                >
                  Last »
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Rows per page:</span>
                <Select
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  options={[
                    { value: '10', label: '10' },
                    { value: '25', label: '25' },
                    { value: '50', label: '50' },
                    { value: '100', label: '100' },
                  ]}
                />
              </div>
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={handleCopyVisiblePage}>
                {copied ? 'Copied to clipboard!' : 'Copy visible page'}
              </Button>
              <Button variant="primary" onClick={handleDownload}>
                Download CSV
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
