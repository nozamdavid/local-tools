import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Select, Alert, Badge } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { downloadBlob } from '../../../lib/download';
import { zipFiles } from '../../../lib/zip';
import {
  MeshViewer,
  use3DWorkbench,
  WorkbenchHeader,
  WorkbenchWarnings,
  ACCEPT_MESH_EXTENSIONS,
  ALL_MESH_FORMATS,
  stripMeshExtension,
  translate3DMessage,
  type MeshFormat,
  type MeshModel,
} from '../_ui';
import { splitModel, exportModel } from '../_mesh/client';
import { Split, Download, Archive, Eye, XCircle } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function SplitTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-split');
  const title = meta.title !== 'three-split' ? meta.title : t('3D Mesh Component Splitter');
  const description = meta.description || t('Decompose multi-part 3D models into separate disconnected component files or a ZIP archive.');

  const {
    file,
    originalModel,
    currentModel,
    setCurrentModel,
    loading,
    importError,
    processing,
    setProcessing,
    processError,
    setProcessError,
    exportFormat,
    setExportFormat,
    jobIdRef,
    loadFiles,
    cancelProcessing,
    reset,
  } = use3DWorkbench({ multiple: false });

  const [components, setComponents] = useState<MeshModel[]>([]);
  const [selectedCompIdx, setSelectedCompIdx] = useState<number>(0);
  const [exportingZip, setExportingZip] = useState<boolean>(false);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);

  const handleSplit = async () => {
    if (!originalModel) return;

    const currentJob = ++jobIdRef.current;
    setProcessing(true);
    setProcessError(null);

    try {
      const parts = await splitModel(originalModel);

      if (currentJob !== jobIdRef.current) return;
      setComponents(parts);
      if (parts.length > 0) {
        setSelectedCompIdx(0);
        setCurrentModel(parts[0]);
      }
    } catch (err: unknown) {
      if (currentJob === jobIdRef.current) {
        setProcessError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentJob === jobIdRef.current) {
        setProcessing(false);
      }
    }
  };

  const handleSelectComponent = (index: number) => {
    setSelectedCompIdx(index);
    if (components[index]) {
      setCurrentModel(components[index]);
    }
  };

  const handleDownloadSingleComponent = async (index: number) => {
    const comp = components[index];
    if (!comp) return;

    setDownloadingIdx(index);
    try {
      const blob = await exportModel(comp, exportFormat);
      const baseName = originalModel?.name || file?.name || 'model';
      const cleanBase = stripMeshExtension(baseName);
      const outName = `${cleanBase}-part-${index + 1}.${exportFormat}`;
      downloadBlob(blob, outName);
    } catch (err: unknown) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingIdx(null);
    }
  };

  const handleDownloadAllZip = async () => {
    if (components.length === 0) return;

    const currentJob = ++jobIdRef.current;
    setExportingZip(true);
    setProcessError(null);

    try {
      const baseName = originalModel?.name || file?.name || 'model';
      const cleanBase = stripMeshExtension(baseName);

      const filesToZip: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < components.length; i++) {
        const comp = components[i];
        const blob = await exportModel(comp, exportFormat);
        if (currentJob !== jobIdRef.current) return;
        filesToZip.push({
          name: `${cleanBase}-part-${i + 1}.${exportFormat}`,
          blob,
        });
      }

      const zipBlob = await zipFiles(filesToZip);
      if (currentJob !== jobIdRef.current) return;

      downloadBlob(zipBlob, `${cleanBase}-components.zip`);
    } catch (err: unknown) {
      if (currentJob === jobIdRef.current) {
        setProcessError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentJob === jobIdRef.current) {
        setExportingZip(false);
      }
    }
  };

  return (
    <ToolPage title={title} description={description} currentId="three-split">
      <div className={styles.workbench}>
        {!originalModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Separate disconnected parts into files or a ZIP. CAD files are converted to meshes first.')}
              onFiles={loadFiles}
            />
            {loading && (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <span className="spinner" aria-hidden="true" />
                <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)' }}>{t('Loading 3D model...')}</p>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <Button variant="ghost" size="sm" onClick={cancelProcessing}>
                    {t('Cancel import')}
                  </Button>
                </div>
              </div>
            )}
            {importError && (
              <Alert tone="danger" title={t('Could not open model')}>
                {translate3DMessage(importError, t)}
              </Alert>
            )}
          </>
        ) : (
          <>
            <WorkbenchHeader
              file={file}
              model={currentModel}
              onReset={() => {
                setComponents([]);
                reset();
              }}
            />
            <WorkbenchWarnings warnings={currentModel?.warnings} />

            {processError && (
              <Alert tone="danger" title={t('Split Error')}>
                {translate3DMessage(processError, t)}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
                {components.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
                    {t('Viewing component {current} of {total} ({triangles} triangles)', {
                      current: selectedCompIdx + 1,
                      total: components.length,
                      triangles: currentModel?.indices.length ? currentModel.indices.length / 3 : 0,
                    })}
                  </div>
                )}
              </div>

              <div className={styles.controlsCol}>
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Split Components')}</span>
                    <Badge tone={components.length > 0 ? 'success' : 'neutral'}>
                      {components.length > 0 ? t('{count} Shells Found', { count: components.length }) : t('Ready to Split')}
                    </Badge>
                  </h3>
                  <p className={styles.cardSub}>{t('Decomposes the mesh into geometrically independent non-connected surface shells.')}</p>

                  <div className={styles.actionRow}>
                    <Button
                      variant="primary"
                      size="lg"
                      icon={<Split size={16} />}
                      loading={processing}
                      disabled={processing}
                      onClick={handleSplit}
                      style={{ flex: 1 }}
                    >
                      {processing ? t('Splitting...') : t('Detect & Split Shells')}
                    </Button>
                    {processing && (
                      <Button variant="danger" size="lg" icon={<XCircle size={16} />} onClick={cancelProcessing}>
                        {t('Cancel')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Target Export Format Selector */}
                {components.length > 0 && (
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>
                      <span>{t('Export Format')}</span>
                    </h3>
                    <div className="field">
                      <Select
                        value={exportFormat}
                        options={ALL_MESH_FORMATS}
                        onChange={(e) => setExportFormat(e.target.value as MeshFormat)}
                      />
                    </div>

                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <Button
                        variant="primary"
                        size="md"
                        icon={<Archive size={15} />}
                        loading={exportingZip}
                        disabled={exportingZip}
                        onClick={handleDownloadAllZip}
                        style={{ width: '100%' }}
                      >
                        {t('Download All ({count} parts) as ZIP', { count: components.length })}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Components List */}
                {components.length > 0 && (
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>
                      <span>{t('Disconnected Parts ({count})', { count: components.length })}</span>
                    </h3>
                    <div className={styles.multiFileList}>
                      {components.map((comp, idx) => {
                        const cTri = comp.indices.length / 3;
                        const cVert = comp.positions.length / 3;
                        const isSelected = selectedCompIdx === idx;

                        return (
                          <div
                            key={idx}
                            className={styles.multiFileItem}
                            style={{
                              borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                              background: isSelected ? 'var(--surface-hover)' : 'var(--surface)',
                            }}
                          >
                            <div>
                              <span className={styles.multiFileItemName}>{t('Part {number}', { number: idx + 1 })}</span>
                              <span className={styles.multiFileItemMeta}>
                                {t('{triangles} triangles • {vertices} vertices', {
                                  triangles: cTri.toLocaleString(),
                                  vertices: cVert.toLocaleString(),
                                })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                              <Button
                                variant={isSelected ? 'primary' : 'secondary'}
                                size="sm"
                                icon={<Eye size={13} />}
                                onClick={() => handleSelectComponent(idx)}
                              >
                                {isSelected ? t('Viewing') : t('View')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<Download size={13} />}
                                loading={downloadingIdx === idx}
                                disabled={downloadingIdx !== null}
                                onClick={() => handleDownloadSingleComponent(idx)}
                              >
                                .{exportFormat}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
