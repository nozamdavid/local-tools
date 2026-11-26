import { useEffect, useState, useRef } from 'react';
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
  type MeshStats,
} from '../_ui';
import { inspectModel } from '../_mesh/client';
import { CheckCircle2, AlertOctagon, Ruler, Info } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

export default function InspectTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-inspect');
  const title = meta.title !== 'three-inspect' ? meta.title : '3D Mesh Inspector & Topology Analyzer';
  const description = meta.description || 'Measure physical dimensions, surface area, volume, and inspect watertight manifold topology.';

  const {
    file,
    currentModel,
    loading,
    importError,
    exporting,
    exportFormat,
    setExportFormat,
    loadFiles,
    cancelProcessing,
    reset,
    lastExportedBlob,
    handleExport,
  } = use3DWorkbench({ multiple: false });

  const [stats, setStats] = useState<MeshStats | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const inspectJobRef = useRef<number>(0);

  useEffect(() => {
    if (!currentModel) {
      setStats(null);
      setAnalysisError(null);
      setAnalyzing(false);
      return;
    }

    const currentJob = ++inspectJobRef.current;
    setAnalyzing(true);
    setAnalysisError(null);

    inspectModel(currentModel)
      .then((res) => {
        if (currentJob === inspectJobRef.current) {
          setStats(res);
        }
      })
      .catch((err) => {
        if (currentJob === inspectJobRef.current) {
          setAnalysisError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (currentJob === inspectJobRef.current) {
          setAnalyzing(false);
        }
      });
    return () => {
      inspectJobRef.current++;
    };
  }, [currentModel]);

  const formatCoord = (n: number) => n.toFixed(2);

  return (
    <ToolPage title={title} description={description} currentId="three-inspect">
      <div className={styles.workbench}>
        {!currentModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Inspect mesh dimensions, topology, area, and volume. CAD files are converted to meshes first.')}
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

            {analysisError && (
              <Alert tone="danger" title={t('Analysis Error')}>
                {translate3DMessage(analysisError, t)}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
              </div>

              <div className={styles.controlsCol}>
                {/* Watertight Status Badge */}
                {stats && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)' }}>{t('Watertight Topology')}</span>
                    {stats.watertight ? (
                      <Badge tone="success" icon={<CheckCircle2 size={14} />}>
                        {t('Watertight (Closed 2-Manifold)')}
                      </Badge>
                    ) : (
                      <Badge tone="warning" icon={<AlertOctagon size={14} />}>
                        {t('Open / Non-Manifold')}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Dimensions Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Bounding Box Dimensions')}</span>
                    <Ruler size={16} aria-hidden="true" />
                  </h3>
                  {analyzing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span className="spinner" aria-hidden="true" />
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{t('Computing bounds...')}</span>
                    </div>
                  ) : stats ? (
                    <>
                      <div className={styles.statRow}>
                        <span className={styles.statLabel}>{t('Size (X × Y × Z)')}</span>
                        <span className={styles.statValue}>
                          {formatCoord(stats.bounds.size[0])} × {formatCoord(stats.bounds.size[1])} × {formatCoord(stats.bounds.size[2])} mm
                        </span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.statLabel}>{t('Min Bounds')}</span>
                        <span className={styles.statValue}>
                          [{formatCoord(stats.bounds.min[0])}, {formatCoord(stats.bounds.min[1])}, {formatCoord(stats.bounds.min[2])}]
                        </span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.statLabel}>{t('Max Bounds')}</span>
                        <span className={styles.statValue}>
                          [{formatCoord(stats.bounds.max[0])}, {formatCoord(stats.bounds.max[1])}, {formatCoord(stats.bounds.max[2])}]
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Geometric Measurements */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Measurements')}</span>
                    <Info size={16} aria-hidden="true" />
                  </h3>
                  {analyzing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span className="spinner" aria-hidden="true" />
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        {t('Computing surface area and volume...')}
                      </span>
                    </div>
                  ) : stats ? (
                    <>
                      <div className={styles.statRow}>
                        <span className={styles.statLabel}>{t('Surface Area')}</span>
                        <span className={styles.statValue}>
                          {stats.surfaceArea.toFixed(1)} mm²{' '}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                            ({(stats.surfaceArea / 100).toFixed(2)} cm²)
                          </span>
                        </span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.statLabel}>{t('Volume')}</span>
                        <span className={styles.statValue}>
                          {stats.volume !== null ? (
                            <>
                              {stats.volume.toFixed(1)} mm³{' '}
                              <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                                ({(stats.volume / 1000).toFixed(2)} cm³ / ml)
                              </span>
                            </>
                          ) : (
                            <span style={{ color: 'var(--warning)', fontStyle: 'italic' }}>{t('N/A (Mesh is open or non-manifold)')}</span>
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                        <em>
                          {t(
                            'Note: Volume requires a closed, watertight mesh. A watertight mesh does not guarantee 3D printability (e.g. wall thickness, structural integrity, or slicer clearances).',
                          )}
                        </em>
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Detailed diagnostics stay available while key topology issues remain visible in the summary. */}
                <details className="tool-options">
                  <summary>
                    {stats
                      ? t('Topology diagnostics · {boundary} boundary · {nonManifold} non-manifold', {
                          boundary: stats.boundaryEdges,
                          nonManifold: stats.nonManifoldEdges,
                        })
                      : t('Topology diagnostics')}
                  </summary>
                  <div className="tool-options-body">
                    <p className={styles.cardSub}>{t('Detailed breakdown of vertex, edge, and face continuity.')}</p>
                    {stats && (
                      <>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Triangles')}</span>
                          <span className={styles.statValue}>{stats.triangles.toLocaleString()}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Vertices')}</span>
                          <span className={styles.statValue}>{stats.vertices.toLocaleString()}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Connected Components')}</span>
                          <span className={styles.statValue}>
                            {stats.components}{' '}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                              {stats.components === 1 ? t('(single solid shell)') : t('(disconnected parts)')}
                            </span>
                          </span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Boundary Edges (Holes)')}</span>
                          <span className={styles.statValue} style={{ color: stats.boundaryEdges > 0 ? 'var(--warning)' : 'inherit' }}>
                            {stats.boundaryEdges.toLocaleString()}{' '}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                              {t('(edges with 1 face)')}
                            </span>
                          </span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Non-Manifold Edges')}</span>
                          <span className={styles.statValue} style={{ color: stats.nonManifoldEdges > 0 ? 'var(--danger)' : 'inherit' }}>
                            {stats.nonManifoldEdges.toLocaleString()}{' '}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                              {t('(edges with >2 faces)')}
                            </span>
                          </span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>{t('Degenerate Triangles')}</span>
                          <span
                            className={styles.statValue}
                            style={{ color: stats.degenerateTriangles > 0 ? 'var(--warning)' : 'inherit' }}
                          >
                            {stats.degenerateTriangles.toLocaleString()}{' '}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
                              {t('(zero-area faces)')}
                            </span>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </details>

                {/* Export Card */}
                <ExportCard
                  model={currentModel}
                  exportFormat={exportFormat}
                  onFormatChange={setExportFormat}
                  onExport={() => handleExport(currentModel, exportFormat)}
                  exporting={exporting}
                  lastExportedBlob={lastExportedBlob}
                  label={t('Export Inspected Model')}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
