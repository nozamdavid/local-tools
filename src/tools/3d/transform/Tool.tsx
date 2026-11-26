import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Checkbox, Select, Input, Alert } from '../../../components/Controls';
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
import { Move3d, RotateCcw, Compass, XCircle } from 'lucide-react';
import styles from '../_ui/Workbench.module.css';

const SCALE_PRESETS = [
  { value: 'custom', label: 'Custom Scale' },
  { value: '1', label: '100% (Original 1.0x)' },
  { value: '25.4', label: 'Inches → Millimeters (25.4x)' },
  { value: '0.0393701', label: 'Millimeters → Inches (0.0394x)' },
  { value: '10', label: 'Centimeters → Millimeters (10x)' },
  { value: '1000', label: 'Meters → Millimeters (1000x)' },
  { value: '0.5', label: 'Half Size (0.5x)' },
  { value: '2', label: 'Double Size (2.0x)' },
];

export default function TransformTool() {
  const { t } = useI18n();
  const meta = getToolMeta('three-transform');
  const title = meta.title !== 'three-transform' ? meta.title : t('3D Mesh Transform & Unit Scaler');
  const description =
    meta.description || t('Scale dimensions, apply inch-to-mm conversions, rotate along XYZ axes, center, and ground to the build plate.');

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

  // Transform parameters
  const [scalePreset, setScalePreset] = useState<string>('1');
  const [uniformScale, setUniformScale] = useState<boolean>(true);
  const [scaleX, setScaleX] = useState<number>(1);
  const [scaleY, setScaleY] = useState<number>(1);
  const [scaleZ, setScaleZ] = useState<number>(1);

  const [rotX, setRotX] = useState<number>(0);
  const [rotY, setRotY] = useState<number>(0);
  const [rotZ, setRotZ] = useState<number>(0);

  const [center, setCenter] = useState<boolean>(true);
  const [ground, setGround] = useState<boolean>(true);

  const isTransformed = !!(originalModel && currentModel && currentModel !== originalModel);

  const handlePresetChange = (presetVal: string) => {
    setScalePreset(presetVal);
    if (presetVal !== 'custom') {
      const val = parseFloat(presetVal);
      if (Number.isFinite(val) && val > 0) {
        setScaleX(val);
        setScaleY(val);
        setScaleZ(val);
      }
    }
  };

  const handleScaleXChange = (val: number) => {
    setScaleX(val);
    setScalePreset('custom');
    if (uniformScale) {
      setScaleY(val);
      setScaleZ(val);
    }
  };

  const handleApplyTransform = async () => {
    if (!originalModel || processing || exporting) return;

    const currentJob = ++jobIdRef.current;
    setProcessing(true);
    setProcessError(null);

    try {
      const sx = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
      const sy = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
      const sz = Number.isFinite(scaleZ) && scaleZ > 0 ? scaleZ : 1;

      // Transform order: scale then rotation (XYZ degrees) then center then groundZ
      const transformed = await processModel(originalModel, {
        kind: 'transform',
        scale: [sx, sy, sz],
        rotation: [rotX, rotY, rotZ],
        center,
        ground,
      });

      if (currentJob !== jobIdRef.current) return;
      setCurrentModel(transformed);
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
      setScalePreset('1');
      setScaleX(1);
      setScaleY(1);
      setScaleZ(1);
      setRotX(0);
      setRotY(0);
      setRotZ(0);
      setCenter(true);
      setGround(true);
      setProcessError(null);
    }
  };

  return (
    <ToolPage title={title} description={description} currentId="three-transform">
      <div className={styles.workbench}>
        {!originalModel ? (
          <>
            <FileDrop
              accept={ACCEPT_MESH_EXTENSIONS}
              multiple={false}
              label={t('Choose a model or CAD file')}
              hint={t('Set model scale and placement. CAD files are converted to meshes first.')}
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
                isTransformed ? (
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
              <Alert tone="danger" title={t('Transform Error')}>
                {translate3DMessage(processError, t)}
              </Alert>
            )}

            <div className={styles.modelGrid}>
              <div className={styles.viewerCol}>
                <MeshViewer model={currentModel} />
              </div>

              <div className={styles.controlsCol}>
                {/* Scale Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Scale')}</span>
                    <Move3d size={16} aria-hidden="true" />
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div className="field">
                      <label className="field-label" htmlFor="scale-preset">
                        {t('Scale preset')}
                      </label>
                      <Select
                        id="scale-preset"
                        value={scalePreset}
                        options={SCALE_PRESETS.map((option) => ({ ...option, label: t(option.label) }))}
                        onChange={(e) => handlePresetChange(e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label className="field-label" htmlFor="scale-factor">
                        {t('Scale factor')}
                      </label>
                      <Input
                        id="scale-factor"
                        type="number"
                        step="0.1"
                        min="0.001"
                        value={scaleX}
                        onChange={(e) => handleScaleXChange(parseFloat(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                </div>

                <details className="tool-options">
                  <summary>{t('Advanced transform settings')}</summary>
                  <div className="tool-options-body">
                    <Checkbox
                      label={t('Uniform scaling')}
                      checked={uniformScale}
                      disabled={processing}
                      onChange={(enabled) => {
                        setUniformScale(enabled);
                        if (enabled) {
                          setScaleY(scaleX);
                          setScaleZ(scaleX);
                        }
                      }}
                    />

                    {!uniformScale && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                        <div className="field">
                          <label className="field-label" htmlFor="scale-y">
                            {t('Scale Y')}
                          </label>
                          <Input
                            id="scale-y"
                            type="number"
                            step="0.1"
                            min="0.001"
                            value={scaleY}
                            onChange={(e) => {
                              setScaleY(parseFloat(e.target.value) || 1);
                              setScalePreset('custom');
                            }}
                          />
                        </div>
                        <div className="field">
                          <label className="field-label" htmlFor="scale-z">
                            {t('Scale Z')}
                          </label>
                          <Input
                            id="scale-z"
                            type="number"
                            step="0.1"
                            min="0.001"
                            value={scaleZ}
                            onChange={(e) => {
                              setScaleZ(parseFloat(e.target.value) || 1);
                              setScalePreset('custom');
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className={styles.cardTitle}>
                      <span>{t('Rotation (degrees)')}</span>
                      <Compass size={16} aria-hidden="true" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
                      <div className="field">
                        <label className="field-label" htmlFor="rotation-x">
                          X
                        </label>
                        <Input
                          id="rotation-x"
                          type="number"
                          step="15"
                          value={rotX}
                          onChange={(e) => setRotX(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor="rotation-y">
                          Y
                        </label>
                        <Input
                          id="rotation-y"
                          type="number"
                          step="15"
                          value={rotY}
                          onChange={(e) => setRotY(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor="rotation-z">
                          Z
                        </label>
                        <Input
                          id="rotation-z"
                          type="number"
                          step="15"
                          value={rotZ}
                          onChange={(e) => setRotZ(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Button variant="secondary" size="sm" onClick={() => setRotX((r) => (r + 90) % 360)}>
                        +90° X
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setRotY((r) => (r + 90) % 360)}>
                        +90° Y
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setRotZ((r) => (r + 90) % 360)}>
                        +90° Z
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRotX(0);
                          setRotY(0);
                          setRotZ(0);
                        }}
                      >
                        {t('Clear rotation')}
                      </Button>
                    </div>
                  </div>
                </details>

                {/* Alignment Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>{t('Placement')}</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <Checkbox label={t('Center model at X = 0, Y = 0')} checked={center} disabled={processing} onChange={setCenter} />
                    <Checkbox label={t('Ground model at Z = 0')} checked={ground} disabled={processing} onChange={setGround} />
                  </div>

                  <div className={styles.actionRow} style={{ marginTop: 'var(--space-4)' }}>
                    <Button
                      variant="primary"
                      size="lg"
                      loading={processing}
                      disabled={processing || exporting}
                      onClick={handleApplyTransform}
                      style={{ flex: 1 }}
                    >
                      {processing ? t('Applying Transform...') : t('Apply Transforms')}
                    </Button>
                    {processing && (
                      <Button variant="danger" size="lg" icon={<XCircle size={16} />} onClick={cancelProcessing}>
                        {t('Cancel')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Export Card */}
                <ExportCard
                  model={currentModel}
                  exportFormat={exportFormat}
                  onFormatChange={setExportFormat}
                  onExport={() => handleExport(currentModel, exportFormat, '-transformed')}
                  exporting={exporting}
                  lastExportedBlob={lastExportedBlob}
                  disabled={processing}
                  label={t('Export Transformed Mesh')}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
