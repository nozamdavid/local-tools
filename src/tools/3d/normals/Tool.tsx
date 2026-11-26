import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Alert, Badge } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import {
  MeshViewer,
  use3DWorkbench,
  WorkbenchHeader,
  WorkbenchWarnings,
  ExportCard,
  ACCEPT_MESH_EXTENSIONS,
  translate3DMessage,
} from '../_ui';
import { processModel } from '../_mesh/client';
import { RotateCcw, XCircle, ShieldAlert, ArrowLeftRight } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function NormalsTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-normals');
  const title = meta.title !== 'three-normals' ? meta.title : t('3D Face Winding & Normals Inverter');
  const description = meta.description || t('Invert triangle face winding globally to fix inside-out geometry and slicing errors.');

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
    exporting,
    exportFormat,
    setExportFormat,
    jobIdRef,
    loadFiles,
    cancelProcessing,
    reset,
    lastExportedBlob,
    handleExport,
  } = use3DWorkbench({ multiple: false });

  const isReversed = !!(originalModel && currentModel && currentModel !== originalModel);

  const handleReverseWinding = async () => {
    if (!originalModel || processing || exporting) return;

    const currentJob = ++jobIdRef.current;
    setProcessing(true);
    setProcessError(null);

    try {
      const processed = await processModel(originalModel, {
        kind: 'normals',
        flip: true,
      });

      if (currentJob !== jobIdRef.current) return;
      setCurrentModel(processed);
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

  const handleResetToOriginal = () => {
    if (originalModel) {
      setCurrentModel(originalModel);
      setProcessError(null);
    }
  };

  return (
    <ToolPage title={title} description={description} currentId="three-normals">
      <div className={styles.workbench}>
        {!originalModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Reverse face direction for inside-out models. CAD files are converted to meshes first.')}
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
              onReset={reset}
              action={
                isReversed ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RotateCcw size={14} />}
                    disabled={processing || exporting}
                    onClick={handleResetToOriginal}
                  >
                    {t('Restore original')}
                  </Button>
                ) : undefined
              }
            />
            <WorkbenchWarnings warnings={currentModel?.warnings} />

            {processError && (
              <Alert tone="danger" title={t('Normals Error')}>
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
                    <span>{t('Face Winding Reversal')}</span>
                    <Badge tone={isReversed ? 'success' : 'neutral'}>
                      {isReversed ? t('Face Winding Reversed') : t('Original Winding')}
                    </Badge>
                  </h3>

                  <Alert tone="info">
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                      <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                      <div>
                        <strong>{t('Notice:')}</strong>{' '}
                        {t(
                          'Triangle winding order defines which direction each face points. Reversing winding swaps vertex indices to flip outward surface normals. Surface normals are recalculated dynamically for viewport rendering and facet headers in binary STL.',
                        )}{' '}
                        <strong>{t('This operation does not automatically fix inconsistent faces')}</strong>{' '}
                        {t('(where adjacent faces have opposing orientation)')} {t('and')} <strong>{t('does not fill holes')}</strong>{' '}
                        {t('or repair open boundaries.')}
                      </div>
                    </div>
                  </Alert>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                      {isReversed
                        ? t('Triangle vertex ordering has been reversed for all faces. Outward normals now face the opposite direction.')
                        : t('Use this operation if your 3D model appears inverted, transparent, or inside-out in slicers or 3D software.')}
                    </div>

                    <div className={styles.actionRow} style={{ marginTop: 'var(--space-2)' }}>
                      <Button
                        variant={isReversed ? 'secondary' : 'primary'}
                        size="lg"
                        icon={<ArrowLeftRight size={16} />}
                        loading={processing}
                        disabled={processing || exporting}
                        onClick={handleReverseWinding}
                        style={{ flex: 1 }}
                      >
                        {processing ? t('Processing...') : isReversed ? t('Re-invert Face Winding') : t('Reverse Face Winding')}
                      </Button>
                      {processing && (
                        <Button variant="danger" size="lg" icon={<XCircle size={16} />} onClick={cancelProcessing}>
                          {t('Cancel')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Export Card */}
                <ExportCard
                  model={currentModel}
                  exportFormat={exportFormat}
                  onFormatChange={setExportFormat}
                  onExport={() => handleExport(currentModel, exportFormat, isReversed ? '-flipped' : '')}
                  exporting={exporting}
                  lastExportedBlob={lastExportedBlob}
                  disabled={processing}
                  label={t('Export Processed Mesh')}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
