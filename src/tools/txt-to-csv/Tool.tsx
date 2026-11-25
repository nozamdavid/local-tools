import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { useI18n } from '../../lib/i18n';
import { copyText } from '../../lib/clipboard';
import { downloadBlob } from '../../lib/download';
import { parseCsv, serializeCsv, detectDelimiter } from '../_tabular/csv';
import styles from './Tool.module.css';

export default function TxtToCsvTool() {
  const { t } = useI18n();
  const meta = getToolMeta('txt-to-csv');
  const title = meta.title !== 'txt-to-csv' ? meta.title : t('TXT to CSV Converter');
  const description = meta.description || t('Convert text, TSV, or log files into clean, standard CSV with quote-aware parsing.');

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
    return parsedRows.reduce((max, row) => Math.max(max, row.length), 0);
  }, [parsedRows]);

  const previewHeaders = useMemo(() => {
    if (parsedRows.length === 0) return [];
    return Array.from({ length: maxCols }, (_, i) => (hasHeader && parsedRows[0][i]?.trim()) || t('Column {number}', { number: i + 1 }));
  }, [parsedRows, hasHeader, maxCols, t]);

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
      await copyText(outputCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      alert(t('Could not copy to clipboard.'));
    }
  };

  const handleReset = () => {
    setInputText('');
    setSourceName('converted.csv');
    setCopied(false);
  };

  const delimiterLabel = (d: string) => {
    if (d === ',') return t('Comma (,)');
    if (d === '\t') return t('Tab (\\t)');
    if (d === ';') return t('Semicolon (;)');
    if (d === '|') return t('Pipe (|)');
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
              {t('Paste text')}
            </button>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'upload' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('upload')}
            >
              {t('Upload file')}
            </button>
          </div>

          {inputTab === 'upload' ? (
            <FileDrop
              accept=".txt,.tsv,.log,.csv,text/*"
              label={t('Choose a TXT, TSV, LOG or CSV file')}
              hint={t('Files are processed entirely on your device.')}
              onFiles={handleFiles}
            />
          ) : (
            <Field label={t('Input text')} hint={t('Paste delimited text, logs, or raw tables')}>
              <textarea
                className={styles.textarea}
                placeholder={`${t('Paste your text here, for example:')}\nname\tage\tcity\nAlice\t28\tNew York\nBob\t34\tSan Francisco`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </Field>
          )}

          <div className={styles.controlsRow}>
            <Field label={t('Delimiter')}>
              <Select
                value={delimiterMode}
                onChange={(e) => setDelimiterMode(e.target.value)}
                options={[
                  { value: 'auto', label: t('Auto-detect (found: {delimiter})', { delimiter: delimiterLabel(detected) }) },
                  { value: ',', label: t('Comma (,)') },
                  { value: '\t', label: t('Tab (\\t)') },
                  { value: ';', label: t('Semicolon (;)') },
                  { value: '|', label: t('Pipe (|)') },
                  { value: 'custom', label: t('Custom character...') },
                ]}
              />
            </Field>

            {delimiterMode === 'custom' && (
              <Field label={t('Custom single character')}>
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
              {t('First row is header')}
            </label>
          </div>
        </div>

        {parsedRows.length > 0 && (
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <div className={styles.previewTitle}>
                {t('CSV preview')}
                <span className={styles.metaBadge}>{t('{count} rows', { count: totalRows })}</span>
                <span className={styles.metaBadge}>{t('{count} columns', { count: maxCols })}</span>
              </div>
              {totalRows > 25 && (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('Showing first {count} rows', { count: 25 })}</span>
              )}
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
                {t('Download CSV ({file})', { file: sourceName })}
              </Button>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? t('Copied to clipboard!') : t('Copy full CSV')}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                {t('Clear')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
