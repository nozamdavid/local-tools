import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Slider, Checkbox, Alert, Badge } from '../../../components/Controls';
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
import { Layers, RotateCcw, Scissors, XCircle, ArrowRight } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function SimplifyTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-simplify');
  const title = meta.title !== 'three-simplify' ? meta.title : t('3D Mesh Simplifier & Decimator');
  const description =
    meta.description || t('Reduce triangle counts and optimize 3D meshes while preserving critical edges and boundary silhouettes.');

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
    handleExport,
  } = use3DWorkbench({ multiple: false });

  // Sliders and options (no hidden processing on drag)
  const [retentionPercent, setRetentionPercent] = useState<number>(50);
  const [errorTolerance, setErrorTolerance] = useState<number>(0.01);
  const [lockBorder, setLockBorder] = useState<boolean>(true);

  const isSimplified = !!(
    originalModel &&
    currentModel &&
    currentModel !== originalModel &&
    currentModel.indices.length !== originalModel.indices.length
  );

  const origTriangles = originalModel ? originalModel.indices.length / 3 : 0;
  const origVertices = originalModel ? originalModel.positions.length / 3 : 0;
  const currentTriangles = currentModel ? currentModel.indices.length / 3 : 0;
  const currentVertices = currentModel ? currentModel.positions.length / 3 : 0;

  const reductionPercent = origTriangles > 0 ? Math.max(0, Math.round((1 - currentTriangles / origTriangles) * 100)) : 0;

  // Run simplification always against originalModel to prevent accumulating decimation
  const handleSimplify = async () => {
    if (!originalModel) return;

    const currentJob = ++jobIdRef.current;
    setProcessing(true);
    setProcessError(null);

    try {
      const ratio = Math.max(0.01, Math.min(1.0, retentionPercent / 100));
      const simplified = await processModel(originalModel, {
        kind: 'simplify',
        ratio,
        error: errorTolerance,
        lockBorder,
      });

      if (currentJob !== jobIdRef.current) return;
      setCurrentModel(simplified);
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
    <ToolPage title={title} description={description} currentId="three-simplify">
      <div className={styles.workbench}>
        {!originalModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Simplify 3D models in your browser. CAD files are converted to meshes first.')}
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
                isSimplified ? (
                  <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={handleResetToOriginal}>
                    {t('Restore original')}
                  </Button>
                ) : undefined
              }
            />
            <WorkbenchWarnings warnings={currentModel?.warnings} />

            {processError && (
              <Alert tone="danger" title={t('Simplification Error')}>
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
                    <span>{t('Decimation Settings')}</span>
                    <Badge tone={isSimplified ? 'success' : 'neutral'}>
                      {isSimplified ? t('-{percent}% Triangles', { percent: reductionPercent }) : t('Original Mesh')}
                    </Badge>
                  </h3>
                  <p className={styles.cardSub}>{t('Adjust parameters below. Click "Simplify Mesh" when ready to process.')}</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div className="field">
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 'var(--space-1)',
                        }}
                      >
                        <label className="field-label" htmlFor="retention-slider">
                          {t('Target Triangle Retention')}
                        </label>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{retentionPercent}%</span>
                      </div>
                      <Slider
                        id="retention-slider"
                        value={retentionPercent}
                        min={1}
                        max={100}
                        step={1}
                        unit="%"
                        disabled={processing}
                        onChange={setRetentionPercent}
                      />
                      <p className="field-hint">
                        {t('Targeting ~{count} triangles ({percent}% reduction).', {
                          count: Math.round((origTriangles * retentionPercent) / 100).toLocaleString(),
                          percent: 100 - retentionPercent,
                        })}
                      </p>
                    </div>

                    <details className="tool-options">
                      <summary>{t('Advanced settings')}</summary>
                      <div className="tool-options-body">
                        <div className="field">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 'var(--space-1)',
                            }}
                          >
                            <label className="field-label" htmlFor="error-slider">
                              {t('Max error tolerance')}
                            </label>
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{errorTolerance}</span>
                          </div>
                          <Slider
                            id="error-slider"
                            value={errorTolerance}
                            min={0.001}
                            max={0.1}
                            step={0.005}
                            disabled={processing}
                            onChange={setErrorTolerance}
                          />
                          <p className="field-hint">{t('Limit how far the simplified surface can move from the original.')}</p>
                        </div>

                        <Checkbox
                          label={t('Protect open boundaries')}
                          checked={lockBorder}
                          disabled={processing}
                          onChange={setLockBorder}
                        />
                      </div>
                    </details>

                    <div className={styles.actionRow}>
                      <Button
                        variant="primary"
                        size="lg"
                        icon={<Scissors size={16} />}
                        loading={processing}
                        disabled={processing}
                        onClick={handleSimplify}
                        style={{ flex: 1 }}
                      >
                        {processing ? t('Simplifying...') : t('Simplify Mesh')}
                      </Button>
                      {processing && (
                        <Button variant="danger" size="lg" icon={<XCircle size={16} />} onClick={cancelProcessing}>
                          {t('Cancel')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Before / After Stats Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Mesh Statistics')}</span>
                    <Layers size={16} aria-hidden="true" />
                  </h3>
                  <div className={styles.statRow}>
                    <span className={styles.statLabel}>{t('Triangles')}</span>
                    <span className={styles.statValue}>
                      {isSimplified ? (
                        <>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                            {origTriangles.toLocaleString()} <ArrowRight size={12} style={{ display: 'inline' }} />{' '}
                          </span>
                          {currentTriangles.toLocaleString()}
                        </>
                      ) : (
                        origTriangles.toLocaleString()
                      )}
                    </span>
                  </div>
                  <div className={styles.statRow}>
                    <span className={styles.statLabel}>{t('Vertices')}</span>
                    <span className={styles.statValue}>
                      {isSimplified ? (
                        <>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                            {origVertices.toLocaleString()} <ArrowRight size={12} style={{ display: 'inline' }} />{' '}
                          </span>
                          {currentVertices.toLocaleString()}
                        </>
                      ) : (
                        origVertices.toLocaleString()
                      )}
                    </span>
                  </div>
                  {isSimplified && (
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>{t('Reduction')}</span>
                      <span className={styles.statValue} style={{ color: 'var(--success)' }}>
                        {t('-{percent}% triangles', { percent: reductionPercent })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Export Card */}
                <ExportCard
                  model={currentModel}
                  exportFormat={exportFormat}
                  onFormatChange={setExportFormat}
                  onExport={() => handleExport(currentModel, exportFormat, '-simplified')}
                  exporting={exporting}
                  disabled={processing}
                  label={t('Export Simplified Mesh')}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
