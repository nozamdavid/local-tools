import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { ProgressBar } from '../../components/ProgressBar';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
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
  const meta = getToolMeta('batch-rename');
  const title = meta.title !== 'batch-rename' ? meta.title : 'Batch File Renamer';
  const description =
    meta.description || 'Rename multiple files with numbering, custom prefixes, extension preservation, and collision protection.';

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
      alert(`Failed to create ZIP: ${(err as Error).message || String(err)}`);
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
          label="Select or drag multiple files to rename"
          hint="Files are processed entirely within your browser memory. No data is uploaded."
          onFiles={handleFiles}
        />

        {files.length > 0 && (
          <>
            {/* Memory safety warning if large */}
            {hasHighMemoryRisk && (
              <div className={styles.memoryWarning}>
                ⚠️ <strong>Memory Advisory:</strong> Combined file size is {formatBytes(totalSizeBytes)}. Bundling over 1GB in browser
                memory may strain system resources. Consider downloading in smaller batches.
              </div>
            )}

            {/* Rename Settings Panel */}
            <div className={styles.configCard}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Rename Rules</h3>

              <div className={styles.configGrid}>
                {/* Naming Mode */}
                <div className={styles.inputField}>
                  <label className={styles.inputLabel}>Name Pattern</label>
                  <select
                    className={styles.selectInput}
                    value={config.mode}
                    onChange={(e) => setConfig({ ...config, mode: e.target.value as any })}
                  >
                    <option value="custom">Custom Base Name</option>
                    <option value="original">Keep Original Name</option>
                  </select>
                </div>

                {/* Base Name Input */}
                {config.mode === 'custom' && (
                  <div className={styles.inputField}>
                    <label className={styles.inputLabel}>Base Name</label>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={config.baseName}
                      onChange={(e) => setConfig({ ...config, baseName: e.target.value })}
                      placeholder="e.g. photo, document"
                    />
                  </div>
                )}

                {/* Numbering Toggle */}
                <div className={styles.inputField}>
                  <label className={styles.inputLabel}>Numbering</label>
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={config.enableNumbering}
                      onChange={(e) => setConfig({ ...config, enableNumbering: e.target.checked })}
                    />
                    Enable Sequential Numbers
                  </label>
                </div>

                {/* Numbering Options */}
                {config.enableNumbering && (
                  <>
                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>Start From</label>
                      <input
                        type="number"
                        min="0"
                        className={styles.textInput}
                        value={config.numberStart}
                        onChange={(e) => setConfig({ ...config, numberStart: parseInt(e.target.value, 10) || 0 })}
                      />
                    </div>

                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>Padding (Digits)</label>
                      <select
                        className={styles.selectInput}
                        value={config.numberPadding}
                        onChange={(e) => setConfig({ ...config, numberPadding: parseInt(e.target.value, 10) })}
                      >
                        <option value={1}>1 (1, 2, 3...)</option>
                        <option value={2}>2 (01, 02, 03...)</option>
                        <option value={3}>3 (001, 002, 003...)</option>
                        <option value={4}>4 (0001, 0002...)</option>
                      </select>
                    </div>

                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>Position</label>
                      <select
                        className={styles.selectInput}
                        value={config.numberPosition}
                        onChange={(e) => setConfig({ ...config, numberPosition: e.target.value as any })}
                      >
                        <option value="suffix">Suffix (name_01.ext)</option>
                        <option value="prefix">Prefix (01_name.ext)</option>
                      </select>
                    </div>

                    <div className={styles.inputField}>
                      <label className={styles.inputLabel}>Separator</label>
                      <select
                        className={styles.selectInput}
                        value={config.separator}
                        onChange={(e) => setConfig({ ...config, separator: e.target.value })}
                      >
                        <option value="_">Underscore (_)</option>
                        <option value="-">Hyphen (-)</option>
                        <option value=" ">Space ( )</option>
                        <option value=".">Dot (.)</option>
                        <option value="">None</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Case Transform */}
                <div className={styles.inputField}>
                  <label className={styles.inputLabel}>Case Transform</label>
                  <select
                    className={styles.selectInput}
                    value={config.caseTransform}
                    onChange={(e) => setConfig({ ...config, caseTransform: e.target.value as any })}
                  >
                    <option value="none">Preserve Case</option>
                    <option value="lower">lowercase</option>
                    <option value="upper">UPPERCASE</option>
                    <option value="title">Title Case</option>
                  </select>
                </div>
              </div>

              {/* Toggles */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '0.5rem' }}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={config.preserveExtension}
                    onChange={(e) => setConfig({ ...config, preserveExtension: e.target.checked })}
                  />
                  Preserve file extension (supports dotfiles like .gitignore and .tar.gz)
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={config.autoResolveCollisions}
                    onChange={(e) => setConfig({ ...config, autoResolveCollisions: e.target.checked })}
                  />
                  Auto-resolve duplicate name collisions
                </label>
              </div>
            </div>

            {/* Stats and Action Bar */}
            <div className={styles.statsBar}>
              <div>
                <strong>{files.length}</strong> files ready &bull; Total: <strong>{formatBytes(totalSizeBytes)}</strong>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={() => setFiles([])}>
                  Clear All
                </Button>
                <Button variant="primary" disabled={zipping || hasCollisions} onClick={handleDownloadZip}>
                  {zipping ? 'Creating ZIP...' : 'Download Renamed ZIP'}
                </Button>
              </div>
            </div>

            {zipping && (
              <div>
                <ProgressBar value={zipProgress} />
              </div>
            )}

            {/* Live Table */}
            <div className={styles.tableWrapper}>
              <table className={styles.fileTable}>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Original Filename</th>
                    <th>New Filename</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th style={{ width: '120px' }}>Actions</th>
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
                          <span className={styles.badgeCollision}>⚠️ Collision</span>
                        ) : item.sanitized ? (
                          <span className={styles.badgeSanitized}>Cleaned</span>
                        ) : (
                          <span className={styles.badgeOk}>OK</span>
                        )}
                      </td>
                      <td>
                        <div className={styles.btnActionGroup}>
                          <button
                            type="button"
                            className={styles.btnMini}
                            disabled={idx === 0}
                            onClick={() => handleMove(idx, 'up')}
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className={styles.btnMini}
                            disabled={idx === files.length - 1}
                            onClick={() => handleMove(idx, 'down')}
                            title="Move down"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className={`${styles.btnMini} ${styles.btnDelete}`}
                            onClick={() => handleRemove(item.id)}
                            title="Remove file"
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
