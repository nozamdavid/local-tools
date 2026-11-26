import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { ProgressBar } from '../../components/ProgressBar';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { computeBatchRename, type RenameConfig } from '../_file-utility/rename';
import JSZip from 'jszip';
import styles from './Tool.module.css';

interface FileEntry {
  id: string;
  file: File;
  name: string;
  size: number;
}

export default function BatchRenameTool() {
  const { t } = useI18n();
  const meta = getToolMeta('batch-rename');
  const title = meta.title !== 'batch-rename' ? meta.title : t('Batch File Renamer');
  const description =
    meta.description || t('Rename multiple files with numbering, custom prefixes, extension preservation, and collision protection.');

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [config, setConfig] = useState<RenameConfig>({
    mode: 'custom',
    baseName: 'file',
    enableNumbering: true,
    numberStart: 1,
    numberPadding: 2,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    findText: '',
    replaceText: '',
    autoResolveCollisions: true,
  });

  const [zipping, setZipping] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<number>(0);

  const handleFiles = (newFiles: File[]) => {
    const entries: FileEntry[] = newFiles.map((f, i) => ({
      id: `${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
      file: f,
      name: f.name,
      size: f.size,
    }));
    setFiles((prev) => [...prev, ...entries]);
  };

  const handleRemove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    setFiles((prev) => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  // Live computed renamed items
  const renamedItems = useMemo(() => {
    return computeBatchRename(
      files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      config,
    );
  }, [files, config]);

  // Combined size & memory check
  const totalSizeBytes = useMemo(() => {
    return files.reduce((acc, f) => acc + f.size, 0);
  }, [files]);

  const hasHighMemoryRisk = totalSizeBytes > 1024 * 1024 * 1024; // > 1GB

  const hasCollisions = useMemo(() => {
    return renamedItems.some((r) => r.hasCollision);
  }, [renamedItems]);

  // Download all renamed files as a ZIP (preserving original bytes exactly)
  const handleDownloadZip = async () => {
    if (files.length === 0 || hasCollisions) return;
    setZipping(true);
    setZipProgress(0.1);

    try {
      const zip = new JSZip();
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const renamed = renamedItems[i];
        zip.file(renamed.newName, item.file);
        setZipProgress(0.1 + (i / files.length) * 0.4);
      }

      const zipBlob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        },
        (metadata) => {
          setZipProgress(0.5 + (metadata.percent / 100) * 0.5);
        },
      );

      downloadBlob(zipBlob, 'renamed-files.zip');
    } catch (err: unknown) {
      alert(t('Failed to create ZIP: {message}', { message: (err as Error).message || String(err) }));
    } finally {
      setZipping(false);
      setZipProgress(0);
    }
  };

  return (
    <ToolPage title={title} description={description} currentId="batch-rename">
      <div className={styles.container}>
        <FileDrop
          multiple={true}
          label={t('Add files to rename')}
          hint={t('Files stay on your device and download together as a ZIP.')}
          onFiles={handleFiles}
        />

        {files.length > 0 && (
          <>
            {/* Memory safety warning if large */}
            {hasHighMemoryRisk && (
              <div className={styles.memoryWarning}>
                ⚠️ <strong>{t('Memory advisory:')}</strong>{' '}
                {t(
                  'Combined file size is {size}. Bundling over 1 GB in browser memory may strain system resources. Consider downloading in smaller batches.',
                  { size: formatBytes(totalSizeBytes) },
                )}
              </div>
            )}

            {/* Rename Settings Panel */}
            <div className={styles.configCard}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('Rename files')}</h3>

              <div className={styles.configGrid}>
                {/* Naming Mode */}
                <div className={styles.inputField}>
                  <label className={styles.inputLabel}>{t('Name pattern')}</label>
                  <select
                    className={styles.selectInput}
                    value={config.mode}
                    onChange={(e) => setConfig({ ...config, mode: e.target.value as any })}
                  >
                    <option value="custom">{t('Custom base name')}</option>
                    <option value="original">{t('Keep original name')}</option>
                  </select>
                </div>

                {/* Base Name Input */}
                {config.mode === 'custom' && (
                  <div className={styles.inputField}>
                    <label className={styles.inputLabel}>{t('Base name')}</label>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={config.baseName}
                      onChange={(e) => setConfig({ ...config, baseName: e.target.value })}
                      placeholder={t('e.g. photo, document')}
                    />
                  </div>
                )}
              </div>

              <details className="tool-options">
                <summary>{t('Advanced rename options')}</summary>
                <div className="tool-options-body">
                  <div className={styles.configGrid}>
                    {/* Numbering Toggle */}
                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>{t('Numbering')}</label>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={config.enableNumbering}
                          onChange={(e) => setConfig({ ...config, enableNumbering: e.target.checked })}
                        />
                        {t('Add sequence numbers')}
                      </label>
                    </div>

                    {/* Numbering Options */}
                    {config.enableNumbering && (
                      <>
                        <div className={styles.inputField}>
                          <label className={styles.inputLabel}>{t('Start from')}</label>
                          <input
                            type="number"
                            min="0"
                            className={styles.textInput}
                            value={config.numberStart}
                            onChange={(e) => setConfig({ ...config, numberStart: parseInt(e.target.value, 10) || 0 })}
                          />
                        </div>

                        <div className={styles.inputField}>
                          <label className={styles.inputLabel}>{t('Number padding')}</label>
                          <select
                            className={styles.selectInput}
                            value={config.numberPadding}
                            onChange={(e) => setConfig({ ...config, numberPadding: parseInt(e.target.value, 10) })}
                          >
                            <option value={1}>{t('{count} digit', { count: 1 })}</option>
                            <option value={2}>{t('{count} digits', { count: 2 })}</option>
                            <option value={3}>{t('{count} digits', { count: 3 })}</option>
                            <option value={4}>{t('{count} digits', { count: 4 })}</option>
                          </select>
                        </div>

                        <div className={styles.inputField}>
                          <label className={styles.inputLabel}>{t('Number position')}</label>
                          <select
                            className={styles.selectInput}
                            value={config.numberPosition}
                            onChange={(e) => setConfig({ ...config, numberPosition: e.target.value as any })}
                          >
                            <option value="suffix">{t('After name')}</option>
                            <option value="prefix">{t('Before name')}</option>
                          </select>
                        </div>

                        <div className={styles.inputField}>
                          <label className={styles.inputLabel}>{t('Separator')}</label>
                          <select
                            className={styles.selectInput}
                            value={config.separator}
                            onChange={(e) => setConfig({ ...config, separator: e.target.value })}
                          >
                            <option value="_">{t('Underscore (_)')}</option>
                            <option value="-">{t('Hyphen (-)')}</option>
                            <option value=" ">{t('Space')}</option>
                            <option value=".">{t('Dot (.)')}</option>
                            <option value="">{t('None')}</option>
                          </select>
                        </div>
                      </>
                    )}

                    {/* Case Transform */}
                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>{t('Letter case')}</label>
                      <select
                        className={styles.selectInput}
                        value={config.caseTransform}
                        onChange={(e) => setConfig({ ...config, caseTransform: e.target.value as any })}
                      >
                        <option value="none">{t('Keep original')}</option>
                        <option value="lower">{t('lowercase')}</option>
                        <option value="upper">{t('UPPERCASE')}</option>
                        <option value="title">{t('Title Case')}</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '0.5rem' }}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={config.preserveExtension}
                        onChange={(e) => setConfig({ ...config, preserveExtension: e.target.checked })}
                      />
                      {t('Keep file extensions')}
                    </label>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={config.autoResolveCollisions}
                        onChange={(e) => setConfig({ ...config, autoResolveCollisions: e.target.checked })}
                      />
                      {t('Resolve duplicate names automatically')}
                    </label>
                  </div>
                </div>
              </details>
            </div>

            {hasCollisions && (
              <div className={styles.collisionWarning} role="alert">
                <strong>{t('Some new names collide.')}</strong> {t('Adjust the rename rules before downloading.')}
              </div>
            )}

            {/* Stats and Action Bar */}
            <div className={styles.statsBar}>
              <div>{t('{count} files ready · Total: {size}', { count: files.length, size: formatBytes(totalSizeBytes) })}</div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={() => setFiles([])}>
                  {t('Clear all')}
                </Button>
                <Button variant="primary" disabled={zipping || hasCollisions} onClick={handleDownloadZip}>
                  {zipping ? t('Creating ZIP…') : t('Download')}
                </Button>
              </div>
            </div>

            {zipping && (
              <div>
                <ProgressBar value={zipProgress} label={t('Creating ZIP…')} />
              </div>
            )}

            {/* Live Table */}
            <div className={styles.tableWrapper}>
              <table className={styles.fileTable}>
                <caption className={styles.previewCaption}>{t('Live preview')}</caption>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>{t('Original filename')}</th>
                    <th>{t('New filename')}</th>
                    <th>{t('Size')}</th>
                    <th>{t('Status')}</th>
                    <th style={{ width: '120px' }}>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {renamedItems.map((item, idx) => (
                    <tr key={item.id} className={item.hasCollision ? styles.collisionRow : ''}>
                      <td>{idx + 1}</td>
                      <td style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{item.originalName}</td>
                      <td style={{ fontWeight: 600, color: '#60a5fa', fontFamily: 'monospace' }}>{item.newName}</td>
                      <td>{formatBytes(item.size)}</td>
                      <td>
                        {item.hasCollision ? (
                          <span className={styles.badgeCollision}>⚠️ {t('Collision')}</span>
                        ) : item.sanitized ? (
                          <span className={styles.badgeSanitized}>{t('Cleaned')}</span>
                        ) : (
                          <span className={styles.badgeOk}>{t('OK')}</span>
                        )}
                      </td>
                      <td>
                        <div className={styles.btnActionGroup}>
                          <button
                            type="button"
                            className={styles.btnMini}
                            disabled={idx === 0}
                            onClick={() => handleMove(idx, 'up')}
                            title={t('Move up')}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className={styles.btnMini}
                            disabled={idx === files.length - 1}
                            onClick={() => handleMove(idx, 'down')}
                            title={t('Move down')}
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className={`${styles.btnMini} ${styles.btnDelete}`}
                            onClick={() => handleRemove(item.id)}
                            title={t('Remove file')}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
