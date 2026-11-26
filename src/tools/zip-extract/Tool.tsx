import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../components/Controls';
import { ContinueWith } from '../../components/ContinueWith';
import { FileDrop } from '../../components/FileDrop';
import { ToolPage } from '../../components/ToolPage';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { translate, useI18n } from '../../lib/i18n';
import { zipFiles } from '../../lib/zip';
import { getToolMeta } from '../registry';
import { extractSelectedZipEntries, inspectZipFile, ZIP_EXTRACT_LIMITS, type ZipArchive } from './zip';
import styles from './Tool.module.css';

function errorMessage(error: unknown): string {
  return translate(error instanceof Error ? error.message : 'Could not open this ZIP archive.');
}

function archiveOutputName(name: string): string {
  const basename =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.zip$/i, '') || 'archive';
  // Filenames must not contain ASCII controls or platform-reserved characters.
  // eslint-disable-next-line no-control-regex
  const safeName = basename.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/[. ]+$/g, '') || 'archive';
  return safeName + '-selected.zip';
}

function directOutputName(name: string): string {
  return name.split('/').pop() || 'download';
}

export default function ZipExtractTool() {
  const { t } = useI18n();
  const meta = getToolMeta('zip-extract');
  const [file, setFile] = useState<File | null>(null);
  const [archive, setArchive] = useState<ZipArchive | null>(null);
  const [result, setResult] = useState<{ name: string; blob: Blob } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadId = useRef(0);

  const reset = () => {
    loadId.current += 1;
    setFile(null);
    setArchive(null);
    setResult(null);
    setSelectedIds(new Set());
    setLoading(false);
    setExtracting(false);
    setError(null);
  };

  const handleFiles = async (files: File[]) => {
    const nextFile = files[0];
    if (!nextFile) return;
    const currentLoad = ++loadId.current;
    setFile(nextFile);
    setArchive(null);
    setResult(null);
    setSelectedIds(new Set());
    setError(null);
    setLoading(true);
    try {
      const inspected = await inspectZipFile(nextFile);
      if (currentLoad !== loadId.current) return;
      setArchive(inspected);
      setSelectedIds(new Set(inspected.entries.map((entry) => entry.id)));
    } catch (reason) {
      if (currentLoad === loadId.current) setError(errorMessage(reason));
    } finally {
      if (currentLoad === loadId.current) setLoading(false);
    }
  };

  const toggleEntry = (id: number) => {
    setResult(null);
    setError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!archive) return;
    setResult(null);
    setError(null);
    setSelectedIds(new Set(archive.entries.map((entry) => entry.id)));
  };

  const selectNone = () => {
    setResult(null);
    setError(null);
    setSelectedIds(new Set());
  };

  const downloadSelected = async () => {
    if (!archive || !file || selectedIds.size === 0) return;
    setExtracting(true);
    setResult(null);
    setError(null);
    try {
      const extracted = await extractSelectedZipEntries(archive, [...selectedIds]);
      let output: { name: string; blob: Blob } | null = null;
      if (extracted.length === 1) {
        output = { name: directOutputName(extracted[0].name), blob: extracted[0].blob };
      } else if (extracted.length > 1) {
        output = {
          name: archiveOutputName(file.name),
          blob: await zipFiles(extracted.map(({ name, blob }) => ({ name, blob }))),
        };
      }
      if (output) {
        downloadBlob(output.blob, output.name);
        setResult(output);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setExtracting(false);
    }
  };

  const selectedBytes = archive?.entries.reduce((total, entry) => (selectedIds.has(entry.id) ? total + entry.size : total), 0) ?? 0;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="zip-extract">
      {!file ? (
        <>
          <FileDrop
            accept="application/zip,.zip"
            label={t('Choose a ZIP file or drag it here')}
            hint={t('Select files to save directly or bundle together. Everything stays on this device.')}
            onFiles={handleFiles}
          />
          <details className="tool-options">
            <summary>{t('Supported limits')}</summary>
            <div className="tool-options-body">
              <p>
                {t('ZIPs up to {archiveSize}, {entryCount} entries, {entrySize} per file, and {expandedSize} expanded total.', {
                  archiveSize: formatBytes(ZIP_EXTRACT_LIMITS.archiveBytes),
                  entryCount: ZIP_EXTRACT_LIMITS.entries.toLocaleString(),
                  entrySize: formatBytes(ZIP_EXTRACT_LIMITS.entryBytes),
                  expandedSize: formatBytes(ZIP_EXTRACT_LIMITS.totalExpandedBytes),
                })}{' '}
                {t('STORE and DEFLATE compression are supported.')}
              </p>
            </div>
          </details>
        </>
      ) : (
        <section className={styles.workspace} aria-label={t('ZIP contents')}>
          <div className={styles.fileSummary}>
            <div>
              <strong className={styles.archiveName}>{file.name}</strong>
              <span className={styles.fileMeta}>{formatBytes(file.size)}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={reset} disabled={loading || extracting}>
              {t('Choose another ZIP')}
            </Button>
          </div>

          {loading && (
            <p className={styles.status} role="status">
              {t('Reading ZIP contents…')}
            </p>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {result && (
            <div className={styles.result}>
              <p role="status">{t('Downloaded {file}.', { file: result.name })}</p>
              <ContinueWith results={[result]} />
            </div>
          )}

          {archive && (
            <>
              <div className={styles.selectionBar}>
                <div className={styles.selectionActions}>
                  <Button variant="ghost" size="sm" onClick={selectAll} disabled={extracting}>
                    {t('Select all')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={selectNone} disabled={extracting}>
                    {t('Select none')}
                  </Button>
                  <span className={styles.selectionSummary}>
                    {t('{count} selected · {size}', { count: selectedIds.size, size: formatBytes(selectedBytes) })}
                  </span>
                </div>
                <Button
                  variant="primary"
                  icon={<Download size={16} />}
                  loading={extracting}
                  disabled={selectedIds.size === 0 || extracting}
                  onClick={downloadSelected}
                  aria-label={t('Download selected')}
                >
                  {t('Download')}
                </Button>
              </div>

              {archive.entries.length > 0 ? (
                <ul className={styles.entryList} aria-label={t('Files in ZIP archive')}>
                  {archive.entries.map((entry) => (
                    <li className={styles.entryRow} key={entry.id}>
                      <label className={styles.entryLabel}>
                        <input
                          type="checkbox"
                          className={styles.entryCheckbox}
                          checked={selectedIds.has(entry.id)}
                          disabled={extracting}
                          onChange={() => toggleEntry(entry.id)}
                        />
                        <span className={styles.entryName} title={entry.name}>
                          {entry.name}
                        </span>
                        <span className={styles.entrySize}>{formatBytes(entry.size)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.status}>{t('This ZIP archive contains no files to extract.')}</p>
              )}

              <details className="tool-options">
                <summary>{t('Supported limits')}</summary>
                <div className="tool-options-body">
                  <p>
                    {t('ZIPs up to {archiveSize}, {entryCount} entries, {entrySize} per file, and {expandedSize} expanded total.', {
                      archiveSize: formatBytes(ZIP_EXTRACT_LIMITS.archiveBytes),
                      entryCount: ZIP_EXTRACT_LIMITS.entries.toLocaleString(),
                      entrySize: formatBytes(ZIP_EXTRACT_LIMITS.entryBytes),
                      expandedSize: formatBytes(ZIP_EXTRACT_LIMITS.totalExpandedBytes),
                    })}{' '}
                    {t('STORE and DEFLATE compression are supported.')}
                  </p>
                </div>
              </details>
            </>
          )}
        </section>
      )}
    </ToolPage>
  );
}
