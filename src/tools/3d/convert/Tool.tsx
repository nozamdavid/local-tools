import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Select, Alert, Badge } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import {
  MeshViewer,
  use3DWorkbench,
  WorkbenchHeader,
  WorkbenchWarnings,
  ACCEPT_MESH_EXTENSIONS,
  ALL_MESH_FORMATS,
  type MeshFormat,
} from '../_ui';
import { ArrowRight, CheckCircle, Download } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function ConvertTool() {
  const meta = getToolMeta('three-convert');
  const title = meta.title !== 'three-convert' ? meta.title : '3D Format Converter';
  const description =
    meta.description || 'Convert 3D mesh files between STL, OBJ, PLY, and 3MF formats entirely on your device.';

  const {
    file,
    currentModel,
    loading,
    importError,
    processError,
    exporting,
    exportFormat,
    setExportFormat,
    lastExportedBlob,
    loadFiles,
    cancelProcessing,
    reset,
    handleExport,
  } = use3DWorkbench({ multiple: false });

  const inputExt = file?.name ? file.name.split('.').pop()?.toLowerCase() || '' : '';

  return (
    <ToolPage title={title} description={description} currentId="three-convert">
      <div className={styles.workbench}>
        {!currentModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label="Drop a 3D model or CAD file (.stl, .obj, .ply, .3mf, .step, .stp, .iges, .igs, .brep)"
              hint="Supports mesh files (STL, OBJ, PLY, 3MF) and CAD models (STEP, IGES, BREP). CAD files are locally tessellated to triangular meshes on-device; export is to 3D mesh formats."
              onFiles={loadFiles}
            />
            {loading && (
              <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                <span className="spinner" aria-hidden="true" />
                <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)' }}>Loading 3D model...</p>
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
            <WorkbenchHeader file={file} model={currentModel} onReset={reset} />
            <WorkbenchWarnings warnings={currentModel.warnings} />

            {processError && (
              <Alert tone="danger" title="Conversion Error">
                {processError}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
              </div>

              <div className={styles.controlsCol}>
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>Choose Target Format</span>
                    {inputExt && <Badge tone="neutral">Source: {inputExt.toUpperCase()}</Badge>}
                  </h3>
                  <p className={styles.cardSub}>
                    Select the format you want to export. All calculations and binary generation occur locally.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div className="field">
                      <label className="field-label">Target 3D Format</label>
                      <Select
                        value={exportFormat}
                        options={ALL_MESH_FORMATS}
                        onChange={(e) => setExportFormat(e.target.value as MeshFormat)}
                      />
                    </div>

                    <Button
                      variant="primary"
                      size="lg"
                      icon={<Download size={16} />}
                      loading={exporting}
                      disabled={exporting}
                      onClick={() => handleExport()}
                    >
                      Convert & Download .{exportFormat.toUpperCase()}
                    </Button>
                  </div>
                </div>

                {lastExportedBlob && (
                  <div className={styles.resultBox}>
                    <div className={styles.resultTitle}>
                      <CheckCircle size={16} color="var(--success)" aria-hidden="true" />
                      <span>Ready for Download</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>Output file</span>
                      <span className={styles.statValue}>{lastExportedBlob.filename}</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>Size</span>
                      <span className={styles.statValue}>
                        {file && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                            {formatBytes(file.size)} <ArrowRight size={12} style={{ display: 'inline' }} />{' '}
                          </span>
                        )}
                        {formatBytes(lastExportedBlob.blob.size)}
                      </span>
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
