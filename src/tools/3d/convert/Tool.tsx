import { ToolPage } from '../../../components/ToolPage';
import { ContinueWith } from '../../../components/ContinueWith';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Select, Alert, Field } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import {
  MeshViewer,
  use3DWorkbench,
  WorkbenchHeader,
  WorkbenchWarnings,
  ACCEPT_MESH_EXTENSIONS,
  ALL_MESH_FORMATS,
  translate3DMessage,
  type MeshFormat,
} from '../_ui';
import { ArrowRight, CheckCircle, Download } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function ConvertTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-convert');
  const title = meta.title !== 'three-convert' ? meta.title : t('3D Format Converter');
  const description = meta.description || t('Convert 3D mesh files between STL, OBJ, PLY, and 3MF formats entirely on your device.');

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

  return (
    <ToolPage title={title} description={description} currentId="three-convert">
      <div className={styles.workbench}>
        {!currentModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Convert 3D model and CAD files to a mesh format. CAD files are converted to meshes first.')}
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
            <WorkbenchHeader file={file} model={currentModel} onReset={reset} />
            <WorkbenchWarnings warnings={currentModel.warnings} />

            {processError && (
              <Alert tone="danger" title={t('Conversion Error')}>
                {translate3DMessage(processError, t)}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
              </div>

              <div className={styles.controlsCol}>
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Convert model')}</span>
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <Field label={t('Output format')}>
                      <Select
                        value={exportFormat}
                        options={ALL_MESH_FORMATS}
                        onChange={(e) => setExportFormat(e.target.value as MeshFormat)}
                      />
                    </Field>

                    <Button
                      variant="primary"
                      size="lg"
                      icon={<Download size={16} />}
                      loading={exporting}
                      disabled={exporting}
                      onClick={() => handleExport()}
                      aria-label={t('Convert and download')}
                    >
                      {t('Download')}
                    </Button>
                  </div>
                </div>

                {lastExportedBlob && (
                  <div className={styles.resultBox}>
                    <div className={styles.resultTitle} role="status" aria-live="polite">
                      <CheckCircle size={16} color="var(--success)" aria-hidden="true" />
                      <span>{t('Download started')}</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>{t('Output file')}</span>
                      <span className={styles.statValue}>{lastExportedBlob.filename}</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>{t('Size')}</span>
                      <span className={styles.statValue}>
                        {file && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                            {formatBytes(file.size)} <ArrowRight size={12} style={{ display: 'inline' }} />{' '}
                          </span>
                        )}
                        {formatBytes(lastExportedBlob.blob.size)}
                      </span>
                    </div>
                    <Button
                      variant="primary"
                      icon={<Download size={15} />}
                      onClick={() => downloadBlob(lastExportedBlob.blob, lastExportedBlob.filename)}
                      aria-label={t('Download {file}', { file: lastExportedBlob.filename })}
                    >
                      {t('Download')}
                    </Button>
                    <ContinueWith results={[{ name: lastExportedBlob.filename, blob: lastExportedBlob.blob }]} />
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
