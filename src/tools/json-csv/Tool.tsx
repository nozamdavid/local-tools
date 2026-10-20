import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { zipFiles } from '../../lib/zip';
import {
  parseCsv,
  csvToRecords,
  jsonToCsv,
  detectDelimiter,
  validateHeaders,
} from '../_tabular/csv';
import styles from './Tool.module.css';

interface BatchResult {
  id: string;
  originalName: string;
  outputName: string;
  blob: Blob;
  preview: string;
  error?: string;
}

export default function JsonCsvTool() {
  const meta = getToolMeta('json-csv');
  const title = meta.title !== 'json-csv' ? meta.title : 'JSON ↔ CSV Converter';
  const description =
    meta.description ||
    'Convert between JSON and CSV with batch processing, stable union headers, and leading zero preservation.';

  const [direction, setDirection] = useState<'json-to-csv' | 'csv-to-json'>('json-to-csv');
  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('paste');
  const [inputText, setInputText] = useState<string>('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [hasHeader, setHasHeader] = useState<boolean>(true);
  const [preserveLeadingZeros, setPreserveLeadingZeros] = useState<boolean>(true);
  const [parseNumbers, setParseNumbers] = useState<boolean>(false);
  const [sourceName, setSourceName] = useState<string>('converted');
  const [copied, setCopied] = useState<boolean>(false);

  // Batch states
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [isBatch, setIsBatch] = useState<boolean>(false);

  // Single conversion logic
  const conversion = useMemo(() => {
    if (!inputText.trim()) {
      return { outputText: '', error: null };
    }

    try {
      if (direction === 'json-to-csv') {
        const csv = jsonToCsv(inputText, { delimiter });
        return { outputText: csv, error: null };
      } else {
        // CSV to JSON
        const effectiveDelim = delimiter === 'auto' ? detectDelimiter(inputText) : delimiter;
        const rows = parseCsv(inputText, { delimiter: effectiveDelim });
        if (rows.length === 0) {
          return { outputText: '[]', error: null };
        }

        if (hasHeader) {
          const headerRow = rows[0].map((h) => h.trim());
          validateHeaders(headerRow);
        }

        const records = csvToRecords(rows, {
          hasHeader,
          preserveLeadingZeros,
          parseNumbersAndBooleans: parseNumbers,
        });

        const json = JSON.stringify(records, null, 2);
        return { outputText: json, error: null };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outputText: '', error: msg };
    }
  }, [inputText, direction, delimiter, hasHeader, preserveLeadingZeros, parseNumbers]);

  const outputFilename = useMemo(() => {
    const ext = direction === 'json-to-csv' ? '.csv' : '.json';
    return `${sourceName}${ext}`;
  }, [sourceName, direction]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;

    if (files.length === 1) {
      // Single file mode
      setIsBatch(false);
      const file = files[0];
      const base = file.name.replace(/\.[^/.]+$/, '');
      setSourceName(base);

      // Auto-detect direction if file extension matches
      if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.tsv')) {
        setDirection('csv-to-json');
      } else if (file.name.toLowerCase().endsWith('.json')) {
        setDirection('json-to-csv');
      }

      const text = await file.text();
      setInputText(text);
      setInputTab('paste');
      return;
    }

    // Multiple files -> Batch mode
    setIsBatch(true);
    setInputTab('upload');
    const results: BatchResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base = file.name.replace(/\.[^/.]+$/, '');
      const outExt = direction === 'json-to-csv' ? '.csv' : '.json';
      const outName = `${base}${outExt}`;

      try {
        const text = await file.text();
        let outText = '';

        if (direction === 'json-to-csv') {
          outText = jsonToCsv(text, { delimiter });
        } else {
          const effectiveDelim = delimiter === 'auto' ? detectDelimiter(text) : delimiter;
          const rows = parseCsv(text, { delimiter: effectiveDelim });
          if (hasHeader && rows.length > 0) {
            validateHeaders(rows[0].map((h) => h.trim()));
          }
          const records = csvToRecords(rows, {
            hasHeader,
            preserveLeadingZeros,
            parseNumbersAndBooleans: parseNumbers,
          });
          outText = JSON.stringify(records, null, 2);
        }

        const mime = direction === 'json-to-csv' ? 'text/csv;charset=utf-8' : 'application/json';
        const blob = new Blob([outText], { type: mime });
        results.push({
          id: `batch-${i}`,
          originalName: file.name,
          outputName: outName,
          blob,
          preview: outText.slice(0, 300),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          id: `batch-${i}`,
          originalName: file.name,
          outputName: outName,
          blob: new Blob([]),
          preview: '',
          error: msg,
        });
      }
    }

    setBatchResults(results);
  };

  const handleDownloadSingle = () => {
    if (!conversion.outputText) return;
    const mime = direction === 'json-to-csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const blob = new Blob([conversion.outputText], { type: mime });
    downloadBlob(blob, outputFilename);
  };

  const handleDownloadZip = async () => {
    const valid = batchResults.filter((r) => !r.error && r.blob.size > 0);
    if (valid.length === 0) return;

    const zipBlob = await zipFiles(
      valid.map((r) => ({
        name: r.outputName,
        blob: r.blob,
      }))
    );
    downloadBlob(zipBlob, `converted-files-${Date.now()}.zip`);
  };

  const handleCopy = async () => {
    if (!conversion.outputText) return;
    try {
      await navigator.clipboard.writeText(conversion.outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleReset = () => {
    setInputText('');
    setBatchResults([]);
    setIsBatch(false);
    setSourceName('converted');
  };

  return (
    <ToolPage title={title} description={description} currentId="json-csv">
      <div className={styles.container}>
        {/* Explicit Direction Selector */}
        <div className={styles.directionToggle}>
          <button
            type="button"
            className={`${styles.directionBtn} ${direction === 'json-to-csv' ? styles.directionBtnActive : ''}`}
            onClick={() => {
              setDirection('json-to-csv');
              setIsBatch(false);
            }}
          >
            JSON → CSV
          </button>
          <button
            type="button"
            className={`${styles.directionBtn} ${direction === 'csv-to-json' ? styles.directionBtnActive : ''}`}
            onClick={() => {
              setDirection('csv-to-json');
              setIsBatch(false);
            }}
          >
            CSV → JSON
          </button>
        </div>

        <div className={styles.card}>
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
              Upload file(s)
            </button>
          </div>

          {inputTab === 'upload' ? (
            <FileDrop
              accept={direction === 'json-to-csv' ? '.json,application/json' : '.csv,.tsv,text/*'}
              multiple
              label={
                direction === 'json-to-csv'
                  ? 'Choose or drag JSON file(s)'
                  : 'Choose or drag CSV/TSV file(s)'
              }
              hint="Multiple files are automatically processed in batch."
              onFiles={handleFiles}
            />
          ) : (
            <Field
              label={direction === 'json-to-csv' ? 'Input JSON' : 'Input CSV'}
              hint={
                direction === 'json-to-csv'
                  ? 'Array of objects, array of arrays, or single object'
                  : 'Delimited text with headers'
              }
            >
              <textarea
                className={styles.textarea}
                placeholder={
                  direction === 'json-to-csv'
                    ? '[\n  { "id": "001", "name": "Alpha", "meta": { "active": true } },\n  { "id": "002", "name": "Beta", "score": 98 }\n]'
                    : 'id,name,zipcode\n001,Alpha,02138\n002,Beta,90210'
                }
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  setIsBatch(false);
                }}
              />
            </Field>
          )}

          {/* Controls */}
          <div className={styles.controlsRow}>
            <Field label="Delimiter">
              <Select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
                options={[
                  { value: ',', label: 'Comma (,)' },
                  { value: ';', label: 'Semicolon (;)' },
                  { value: '\t', label: 'Tab (\\t)' },
                  { value: '|', label: 'Pipe (|)' },
                  ...(direction === 'csv-to-json' ? [{ value: 'auto', label: 'Auto-detect' }] : []),
                ]}
              />
            </Field>

            {direction === 'csv-to-json' && (
              <>
                <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={(e) => setHasHeader(e.target.checked)}
                  />
                  First row is header
                </label>

                <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
                  <input
                    type="checkbox"
                    checked={preserveLeadingZeros}
                    onChange={(e) => setPreserveLeadingZeros(e.target.checked)}
                  />
                  Preserve leading zeros & string IDs
                </label>

                <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
                  <input
                    type="checkbox"
                    checked={parseNumbers}
                    onChange={(e) => setParseNumbers(e.target.checked)}
                  />
                  Parse numbers & booleans
                </label>
              </>
            )}
          </div>
        </div>

        {/* Error message */}
        {conversion.error && (
          <div className={styles.errorBanner}>
            <span>⚠️</span>
            <span>{conversion.error}</span>
          </div>
        )}

        {/* Single Conversion Result */}
        {!isBatch && conversion.outputText && (
          <div className={styles.resultCard}>
            <div className={styles.resultHeader}>
              <div className={styles.resultTitle}>
                Converted {direction === 'json-to-csv' ? 'CSV' : 'JSON'} Result
                <span className={styles.metaBadge}>{outputFilename}</span>
              </div>
            </div>

            <pre className={styles.previewText}>{conversion.outputText}</pre>

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleDownloadSingle}>
                Download {outputFilename}
              </Button>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? 'Copied to clipboard!' : 'Copy to clipboard'}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Batch Conversion Results */}
        {isBatch && batchResults.length > 0 && (
          <div className={styles.resultCard}>
            <div className={styles.resultHeader}>
              <div className={styles.resultTitle}>
                Batch Conversion Results ({batchResults.length} files)
              </div>
              <Button variant="primary" onClick={handleDownloadZip}>
                Download All as ZIP
              </Button>
            </div>

            <div className={styles.batchList}>
              {batchResults.map((item) => (
                <div key={item.id} className={styles.batchItem}>
                  <div>
                    <div className={styles.batchName}>{item.originalName} → {item.outputName}</div>
                    {item.error ? (
                      <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                        Error: {item.error}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Ready ({item.blob.size} bytes)
                      </span>
                    )}
                  </div>
                  {!item.error && (
                    <Button
                      variant="secondary"
                      onClick={() => downloadBlob(item.blob, item.outputName)}
                    >
                      Download
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={handleReset}>
                Clear batch
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
