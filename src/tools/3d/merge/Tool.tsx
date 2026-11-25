import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Alert, Badge } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { MeshViewer, use3DWorkbench, ExportCard, ACCEPT_MESH_EXTENSIONS, translate3DMessage, type MeshModel } from '../_ui';
import { mergeModels } from '../_mesh/client';
import { Combine, Trash2, XCircle, ShieldAlert, Plus, RotateCcw } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function MergeTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-merge');
  const title = meta.title !== 'three-merge' ? meta.title : t('3D Mesh Merger');
  const description = meta.description || t('Combine and flatten multiple 3D model files into a single unified mesh container.');

  const {
    files,
    multiModels,
    currentModel,
    setCurrentModel,
    loading,
    importError,
    processing,
    setProcessing,
    processError,
    setProcessError,
    exporting,
    exportFormat,
    setExportFormat,
    jobIdRef,
    loadFiles,
    removeMultiFile,
    cancelProcessing,
    reset,
    lastExportedBlob,
    handleExport,
  } = use3DWorkbench({ multiple: true });

  const [mergedModel, setMergedModel] = useState<MeshModel | null>(null);

  const totalInputTriangles = multiModels.reduce((acc, m) => acc + m.indices.length / 3, 0);
  const totalInputVertices = multiModels.reduce((acc, m) => acc + m.positions.length / 3, 0);

  const handleMerge = async () => {
    if (multiModels.length < 2) return;

    const currentJob = ++jobIdRef.current;
    setProcessing(true);
    setProcessError(null);

    try {
      const merged = await mergeModels(multiModels);

      if (currentJob !== jobIdRef.current) return;
      setMergedModel(merged);
      setCurrentModel(merged);
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

  const handleReset = () => {
    setMergedModel(null);
    reset();
  };

  return (
    <ToolPage title={title} description={description} currentId="three-merge">
      <div className={styles.workbench}>
        {multiModels.length === 0 ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={true}
              label={t('Choose 2 or more models or CAD files')}
              hint={t('Combine models into one mesh. CAD files are converted to meshes first.')}
              onFiles={loadFiles}
            />
            {loading && (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <span className="spinner" aria-hidden="true" />
                <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)' }}>{t('Loading 3D models...')}</p>
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
            <div className={styles.fileHeader}>
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>
                  {mergedModel ? t('Merged 3D Mesh') : t('{count} Models Loaded', { count: multiModels.length })}
                </span>
                <span className={styles.fileMeta}>
                  {t('Total: {triangles} triangles • {vertices} vertices', {
                    triangles: totalInputTriangles.toLocaleString(),
                    vertices: totalInputVertices.toLocaleString(),
                  })}
                </span>
              </div>
              <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={handleReset}>
                {t('Start over')}
              </Button>
            </div>

            {processError && (
              <Alert tone="danger" title={t('Merge Error')}>
                {translate3DMessage(processError, t)}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
                {mergedModel && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
                    {t('Viewing unified merged mesh ({count} triangles)', { count: mergedModel.indices.length / 3 })}
                  </div>
                )}
              </div>

              <div className={styles.controlsCol}>
                {/* Notice: No boolean union claim */}
                <Alert tone="info">
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                    <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <div>
                      <strong>{t('Flatten Notice:')}</strong> {t('Combines and flattens geometry buffers into a single mesh container.')}{' '}
                      <strong>{t('This does not perform CSG Boolean union operations')}</strong>{' '}
                      {t('(no intersection carving or seam welding).')}
                    </div>
                  </div>
                </Alert>

                {/* Models List */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Loaded 3D Models ({count})', { count: multiModels.length })}</span>
                    <Badge tone={multiModels.length >= 2 ? 'success' : 'warning'}>
                      {multiModels.length >= 2 ? t('Ready to merge') : t('Need at least 2 models')}
                    </Badge>
                  </h3>

                  <div className={styles.multiFileList}>
                    {multiModels.map((m, idx) => {
                      const mTri = m.indices.length / 3;
                      const mVert = m.positions.length / 3;
                      const f = files[idx];

                      return (
                        <div key={idx} className={styles.multiFileItem}>
                          <div>
                            <span className={styles.multiFileItemName}>
                              {f?.name || m.name || t('Model {number}', { number: idx + 1 })}
                            </span>
                            <span className={styles.multiFileItemMeta}>
                              {t('{triangles} triangles • {vertices} vertices', {
                                triangles: mTri.toLocaleString(),
                                vertices: mVert.toLocaleString(),
                              })}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={14} color="var(--danger)" />}
                            onClick={() => removeMultiFile(idx)}
                            title={t('Remove model')}
                            disabled={processing}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <label style={{ flex: 1 }}>
                      <input
                        type="file"
                        accept={ACCEPT_MESH_EXTENSIONS}
                        multiple
                        hidden
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            loadFiles(Array.from(e.target.files));
                            e.target.value = '';
                          }
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="md"
                        icon={<Plus size={15} />}
                        onClick={(e) => {
                          const input = e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement;
                          input?.click();
                        }}
                        style={{ width: '100%' }}
                      >
                        {t('Add more models')}
                      </Button>
                    </label>

                    <Button
                      variant="primary"
                      size="md"
                      icon={<Combine size={15} />}
                      loading={processing}
                      disabled={multiModels.length < 2 || processing}
                      onClick={handleMerge}
                      style={{ flex: 1 }}
                    >
                      {processing ? t('Merging...') : t('Merge Models')}
                    </Button>
                  </div>

                  {processing && (
                    <Button variant="danger" size="md" icon={<XCircle size={15} />} onClick={cancelProcessing}>
                      {t('Cancel')}
                    </Button>
                  )}
                </div>

                {/* Export Card */}
                {mergedModel && (
                  <ExportCard
                    model={mergedModel}
                    exportFormat={exportFormat}
                    onFormatChange={setExportFormat}
                    onExport={() => handleExport(mergedModel, exportFormat, '-merged')}
                    exporting={exporting}
                    lastExportedBlob={lastExportedBlob}
                    disabled={processing}
                    label={t('Export Merged Mesh')}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
