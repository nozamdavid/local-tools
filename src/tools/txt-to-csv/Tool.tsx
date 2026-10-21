import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { parseCsv, serializeCsv, detectDelimiter } from '../_tabular/csv';
import styles from './Tool.module.css';

export default function TxtToCsvTool() {
  const meta = getToolMeta('txt-to-csv');
  const title = meta.title !== 'txt-to-csv' ? meta.title : 'TXT to CSV Converter';
  const description = meta.description || 'Convert text, TSV, or log files into clean, standard CSV with quote-aware parsing.';

  const [inputTab, setInputTab] = useState<'upload' | 'paste'>('paste');
  const [inputText, setInputText] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('converted.csv');
  const [delimiterMode, setDelimiterMode] = useState<string>('auto');
  const [customChar, setCustomChar] = useState<string>('');
  const [hasHeader, setHasHeader] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    setSourceName(`${baseName}.csv`);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      setInputText(text);
      setInputTab('paste');
    };
    reader.readAsText(file);
  };

  // Determine actual delimiter
  const detected = useMemo(() => {
    if (!inputText) return ',';
    return detectDelimiter(inputText);
  }, [inputText]);

  const activeDelimiter = useMemo(() => {
    if (delimiterMode === 'auto') return detected;
    if (delimiterMode === 'custom') return customChar.length > 0 ? customChar[0] : ',';
    return delimiterMode;
  }, [delimiterMode, detected, customChar]);

  // Parse rows
  const parsedRows = useMemo(() => {
    if (!inputText.trim()) return [];
    try {
      return parseCsv(inputText, { delimiter: activeDelimiter });
    } catch {
      return [];
    }
  }, [inputText, activeDelimiter]);

  // Preview data
  const totalRows = parsedRows.length;
  const maxCols = useMemo(() => {
    if (parsedRows.length === 0) return 0;
    return Math.max(...parsedRows.map((r) => r.length));
  }, [parsedRows]);

  const previewHeaders = useMemo(() => {
    if (parsedRows.length === 0) return [];
    if (hasHeader) {
      return parsedRows[0].map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`));
    }
    return Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  }, [parsedRows, hasHeader, maxCols]);

  const previewBodyRows = useMemo(() => {
    if (parsedRows.length === 0) return [];
    const rows = hasHeader ? parsedRows.slice(1) : parsedRows;
    return rows.slice(0, 25);
  }, [parsedRows, hasHeader]);

  // CSV Output
  const outputCsv = useMemo(() => {
    if (parsedRows.length === 0) return '';
    return serializeCsv(parsedRows, ',');
  }, [parsedRows]);

  const handleDownload = () => {
    if (!outputCsv) return;
    const blob = new Blob([outputCsv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, sourceName);
  };

  const handleCopy = async () => {
    if (!outputCsv) return;
    try {
      await navigator.clipboard.writeText(outputCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const handleReset = () => {
    setInputText('');
    setSourceName('converted.csv');
    setCopied(false);
  };

  const delimiterLabel = (d: string) => {
    if (d === ',') return 'Comma (,)';
    if (d === '\t') return 'Tab (\\t)';
    if (d === ';') return 'Semicolon (;)';
    if (d === '|') return 'Pipe (|)';
    return `"${d}"`;
  };

  return (
    <ToolPage title={title} description={description} currentId="txt-to-csv">
      <div className={styles.container}>
        <div className={styles.inputSection}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'paste' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('paste')}
            >
              Paste text
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
              accept=".txt,.tsv,.log,.csv,text/*"
              label="Choose a TXT, TSV, LOG or CSV file"
              hint="Files are processed entirely on your device."
              onFiles={handleFiles}
            />
          ) : (
            <Field label="Input text" hint="Paste delimited text, logs, or raw tables">
              <textarea
                className={styles.textarea}
                placeholder="Paste your text here... e.g.&#10;name&#9;age&#9;city&#10;Alice&#9;28&#9;New York&#10;Bob&#9;34&#9;San Francisco"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </Field>
          )}

          <div className={styles.controlsRow}>
            <Field label="Delimiter">
              <Select
                value={delimiterMode}
                onChange={(e) => setDelimiterMode(e.target.value)}
                options={[
                  { value: 'auto', label: `Auto-detect (found: ${delimiterLabel(detected)})` },
                  { value: ',', label: 'Comma (,)' },
                  { value: '\t', label: 'Tab (\\t)' },
                  { value: ';', label: 'Semicolon (;)' },
                  { value: '|', label: 'Pipe (|)' },
                  { value: 'custom', label: 'Custom character...' },
                ]}
              />
            </Field>

            {delimiterMode === 'custom' && (
              <Field label="Custom single character">
                <input
                  type="text"
                  maxLength={1}
                  className="select"
                  style={{ width: '80px', textAlign: 'center' }}
                  value={customChar}
                  onChange={(e) => setCustomChar(e.target.value)}
                  placeholder=":"
                />
              </Field>
            )}

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is header
            </label>
          </div>
        </div>

        {parsedRows.length > 0 && (
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <div className={styles.previewTitle}>
                CSV Preview
                <span className={styles.metaBadge}>{totalRows} rows</span>
                <span className={styles.metaBadge}>{maxCols} columns</span>
              </div>
              {totalRows > 25 && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Showing first 25 rows</span>}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '48px', color: 'var(--text-muted)' }}>#</th>
                    {previewHeaders.map((hdr, idx) => (
                      <th key={idx}>{hdr}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewBodyRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      <td style={{ color: 'var(--text-muted)' }}>{rIdx + 1}</td>
                      {previewHeaders.map((_, cIdx) => (
                        <td key={cIdx}>{cIdx < row.length ? row[cIdx] : ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleDownload}>
                Download CSV ({sourceName})
              </Button>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? 'Copied to clipboard!' : 'Copy full CSV'}
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
