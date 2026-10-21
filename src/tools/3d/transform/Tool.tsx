import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Checkbox, Select, Input, Alert } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { MeshViewer, use3DWorkbench, WorkbenchHeader, WorkbenchWarnings, ExportCard, ACCEPT_MESH_EXTENSIONS } from '../_ui';
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
  const meta = getToolMeta('three-transform');
  const title = meta.title !== 'three-transform' ? meta.title : '3D Mesh Transform & Unit Scaler';
  const description =
    meta.description || 'Scale dimensions, apply inch-to-mm conversions, rotate along XYZ axes, center, and ground to the build plate.';

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
    if (!originalModel) return;

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
              label="Drop a 3D model or CAD file to transform (.stl, .obj, .ply, .3mf, .step, .stp, .iges, .igs, .brep)"
              hint="Apply unit scaling, coordinate reorientation, auto-centering, and bed grounding. CAD files are tessellated locally to meshes upon import."
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
            <WorkbenchHeader
              file={file}
              model={currentModel}
              onReset={reset}
              action={
                isTransformed ? (
                  <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={handleResetToOriginal}>
                    Restore original
                  </Button>
                ) : undefined
              }
            />
            <WorkbenchWarnings warnings={currentModel?.warnings} />

            {processError && (
              <Alert tone="danger" title="Transform Error">
                {processError}
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
                    <span>Dimensions &amp; Scale</span>
                    <Move3d size={16} aria-hidden="true" />
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div className="field">
                      <label className="field-label">Unit / Scale Preset</label>
                      <Select value={scalePreset} options={SCALE_PRESETS} onChange={(e) => handlePresetChange(e.target.value)} />
                    </div>

                    <div>
                      <Checkbox
                        label="Uniform scaling (preserve proportions across all axes)"
                        checked={uniformScale}
                        disabled={processing}
                        onChange={setUniformScale}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
                      <div className="field">
                        <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                          Scale X
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0.001"
                          value={scaleX}
                          onChange={(e) => handleScaleXChange(parseFloat(e.target.value) || 1)}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                          Scale Y
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0.001"
                          disabled={uniformScale}
                          value={scaleY}
                          onChange={(e) => {
                            setScaleY(parseFloat(e.target.value) || 1);
                            setScalePreset('custom');
                          }}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                          Scale Z
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0.001"
                          disabled={uniformScale}
                          value={scaleZ}
                          onChange={(e) => {
                            setScaleZ(parseFloat(e.target.value) || 1);
                            setScalePreset('custom');
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rotation Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>Rotation (Degrees)</span>
                    <Compass size={16} aria-hidden="true" />
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
                    <div className="field">
                      <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Rotate X°
                      </label>
                      <Input type="number" step="15" value={rotX} onChange={(e) => setRotX(parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="field">
                      <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Rotate Y°
                      </label>
                      <Input type="number" step="15" value={rotY} onChange={(e) => setRotY(parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="field">
                      <label className="field-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Rotate Z°
                      </label>
                      <Input type="number" step="15" value={rotZ} onChange={(e) => setRotZ(parseFloat(e.target.value) || 0)} />
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
                      Clear rotation
                    </Button>
                  </div>
                </div>

                {/* Alignment Card */}
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>
                    <span>Alignment &amp; Placement</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <Checkbox
                      label="Center mesh origin (center bounding box at X=0, Y=0)"
                      checked={center}
                      disabled={processing}
                      onChange={setCenter}
                    />
                    <Checkbox
                      label="Ground to build plate (place lowest vertex at Z=0 mm)"
                      checked={ground}
                      disabled={processing}
                      onChange={setGround}
                    />
                  </div>

                  <div className={styles.actionRow} style={{ marginTop: 'var(--space-4)' }}>
                    <Button
                      variant="primary"
                      size="lg"
                      loading={processing}
                      disabled={processing}
                      onClick={handleApplyTransform}
                      style={{ flex: 1 }}
                    >
                      {processing ? 'Applying Transform...' : 'Apply Transforms'}
                    </Button>
                    {processing && (
                      <Button variant="danger" size="lg" icon={<XCircle size={16} />} onClick={cancelProcessing}>
                        Cancel
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
                  disabled={processing}
                  label="Export Transformed Mesh"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
