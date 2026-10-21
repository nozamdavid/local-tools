import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Alert, Badge } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { MeshViewer, use3DWorkbench, ExportCard, ACCEPT_MESH_EXTENSIONS, type MeshModel } from '../_ui';
import { mergeModels } from '../_mesh/client';
import { Combine, Trash2, XCircle, ShieldAlert, Plus, RotateCcw } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function MergeTool() {
  const meta = getToolMeta('three-merge');
  const title = meta.title !== 'three-merge' ? meta.title : '3D Mesh Merger';
  const description = meta.description || 'Combine and flatten multiple 3D model files into a single unified mesh container.';

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
              label="Drop 2 or more 3D models or CAD files to combine (.stl, .obj, .ply, .3mf, .step, .stp, .iges, .igs, .brep)"
              hint="Select multiple mesh or CAD files to combine into a single unified mesh. CAD files are tessellated locally to meshes upon import."
              onFiles={loadFiles}
            />
            {loading && (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <span className="spinner" aria-hidden="true" />
                <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)' }}>Loading 3D models...</p>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <Button variant="ghost" size="sm" onClick={cancelProcessing}>
                    Cancel import
                  </Button>
                </div>
              </div>
            )}
            {importError && (
              <Alert tone="danger" title="Could not open model">
                {importError}
              </Alert>
            )}
          </>
        ) : (
          <>
            <div className={styles.fileHeader}>
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{mergedModel ? 'Merged 3D Mesh' : `${multiModels.length} Models Loaded`}</span>
                <span className={styles.fileMeta}>
                  Total: {totalInputTriangles.toLocaleString()} triangles • {totalInputVertices.toLocaleString()} vertices
                </span>
              </div>
              <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={handleReset}>
                Start over
              </Button>
            </div>

            {processError && (
              <Alert tone="danger" title="Merge Error">
                {processError}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
                {mergedModel && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Viewing unified merged mesh ({mergedModel.indices.length / 3} triangles)
                  </div>
                )}
              </div>

              <div className={styles.controlsCol}>
                {/* Notice: No boolean union claim */}
                <Alert tone="info">
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                    <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <div>
                      <strong>Flatten Notice:</strong> Combines and flattens geometry buffers into a single mesh container.{' '}
                      <strong>This does not perform CSG Boolean union operations</strong> (no intersection carving or seam welding).
                    </div>
                  </div>
                </Alert>

                {/* Models List */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>Loaded 3D Models ({multiModels.length})</span>
                    <Badge tone={multiModels.length >= 2 ? 'success' : 'warning'}>
                      {multiModels.length >= 2 ? 'Ready to merge' : 'Need at least 2 models'}
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
                            <span className={styles.multiFileItemName}>{f?.name || m.name || `Model ${idx + 1}`}</span>
                            <span className={styles.multiFileItemMeta}>
                              {mTri.toLocaleString()} triangles • {mVert.toLocaleString()} vertices
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={14} color="var(--danger)" />}
                            onClick={() => removeMultiFile(idx)}
                            title="Remove model"
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
                        Add more models
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
                      {processing ? 'Merging...' : 'Merge Models'}
                    </Button>
                  </div>

                  {processing && (
                    <Button variant="danger" size="md" icon={<XCircle size={15} />} onClick={cancelProcessing}>
                      Cancel
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
                    disabled={processing}
                    label="Export Merged Mesh"
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
