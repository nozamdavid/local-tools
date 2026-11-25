import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ContinueWith } from '../../../components/ContinueWith';
import { Alert, Button, Field, Select } from '../../../components/Controls';
import { FileDrop } from '../../../components/FileDrop';
import { ToolPage } from '../../../components/ToolPage';
import { formatBytes } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { classifyFile, extensionOf, isToolEligibleForBatch, mimeOf, VIEWER_ACCEPT } from '../../../lib/toolInputs';
import { getToolMeta } from '../../registry';
import { CAD_ACCEPT, getCadFormat } from '../_cad/client';
import { DEFAULT_MESH_GEOMETRY_LIMITS } from '../_mesh/validation';
import { ALL_MESH_FORMATS, MeshViewer, WorkbenchWarnings, translate3DMessage, use3DWorkbench, type MeshFormat } from '../_ui';
import type { LocalSceneAsset } from './gltf';
import styles from './Tool.module.css';

type OpenScene = { file: File; format: 'glb' | 'gltf'; asset: LocalSceneAsset };
type ViewerError = { message: string; params?: { path: string } };

const cadTypes = CAD_ACCEPT.split(',');
const meshMimeFormats: Partial<Record<string, MeshFormat>> = {
  'model/stl': 'stl',
  'application/sla': 'stl',
  'model/obj': 'obj',
  'text/obj': 'obj',
  'application/x-tgif': 'obj',
  'model/ply': 'ply',
  'model/3mf': '3mf',
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml': '3mf',
};

function getSourceFormat(file: File) {
  const extension = `.${extensionOf(file.name)}`;
  const mime = mimeOf(file);
  // Follow the importer's precedence when MIME and extension disagree.
  if (cadTypes.includes(extension) || cadTypes.includes(mime)) return getCadFormat(file.name, mime);
  return ALL_MESH_FORMATS.find((format) => format.ext === extension)?.value ?? meshMimeFormats[mime];
}

function getBoundingBoxSize(positions: Float32Array) {
  if (positions.length === 0) return [0, 0, 0];

  let [minX, minY, minZ] = positions;
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (let i = 3; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return [maxX - minX, maxY - minY, maxZ - minZ];
}

export default function ViewerTool() {
  const { t, locale } = useI18n();
  const meta = getToolMeta('three-viewer');
  const { file, currentModel, loading, importError, processError, loadFiles, cancelProcessing, reset } = use3DWorkbench({
    importIntent: 'viewer',
  });
  const mounted = useRef(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const sceneRequest = useRef<AbortController | null>(null);
  const sceneAsset = useRef<LocalSceneAsset | null>(null);
  const [scene, setScene] = useState<OpenScene | null>(null);
  const [loadingScene, setLoadingScene] = useState(false);
  const [viewerError, setViewerError] = useState<ViewerError | null>(null);
  const [sceneFolder, setSceneFolder] = useState<{ files: File[]; scenes: File[] } | null>(null);

  const releaseScene = useCallback(() => {
    sceneRequest.current?.abort();
    sceneRequest.current = null;
    sceneAsset.current?.dispose();
    sceneAsset.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseScene();
    };
  }, [releaseScene]);

  function clearViewer() {
    releaseScene();
    setScene(null);
    setLoadingScene(false);
    setViewerError(null);
    setSceneFolder(null);
    reset();
  }

  async function loadSelection(files: File[]) {
    clearViewer();
    const primaryScene = files.find((candidate) => classifyFile(candidate).isGltf);
    const primaryMesh = files.length === 1 && !primaryScene ? files[0] : null;

    if (primaryMesh && getSourceFormat(primaryMesh)) {
      await loadFiles([primaryMesh]);
      return;
    }

    if (!primaryScene || (files.length > 1 && !isToolEligibleForBatch(meta, files))) {
      setViewerError({ message: 'Choose one 3D model. Select any BIN or texture files together with its GLB or glTF file.' });
      return;
    }

    const { format } = classifyFile(primaryScene);
    if (format !== 'glb' && format !== 'gltf') return;

    const request = new AbortController();
    sceneRequest.current = request;
    setLoadingScene(true);
    try {
      const { loadLocalScene } = await import('./gltf');
      if (request.signal.aborted) return;
      const asset = await loadLocalScene(
        primaryScene,
        files.filter((candidate) => candidate !== primaryScene),
        request.signal,
      );
      if (request.signal.aborted) {
        asset.dispose();
        return;
      }

      sceneAsset.current = asset;
      setScene({ file: primaryScene, format, asset });
    } catch (error) {
      if (!request.signal.aborted) {
        setViewerError(
          error instanceof Error ? { message: error.message, params: (error as Error & ViewerError).params } : { message: String(error) },
        );
      }
    } finally {
      if (sceneRequest.current === request) {
        sceneRequest.current = null;
        setLoadingScene(false);
      }
    }
  }

  function openFiles(files: File[]) {
    // FileDrop consumes a handoff during mount. Start the import after Strict Mode's effect replay.
    queueMicrotask(() => {
      if (mounted.current) void loadSelection(files);
    });
  }

  function openFolderScene(primary: File, files: File[]) {
    const companions = files.filter((candidate) => isToolEligibleForBatch(meta, [primary, candidate]));
    openFiles([primary, ...companions]);
  }

  function openFolder(files: File[]) {
    const scenes = files.filter((candidate) => classifyFile(candidate).isGltf);
    if (scenes.length === 1) {
      openFolderScene(scenes[0], files);
      return;
    }

    clearViewer();
    if (scenes.length === 0) {
      setViewerError({ message: 'This folder contains no GLB or glTF scene. Choose another folder.' });
    } else {
      setSceneFolder({ files, scenes });
    }
  }

  function cancelImport() {
    releaseScene();
    setLoadingScene(false);
    cancelProcessing();
  }

  const positions = currentModel?.positions;
  const meshSize = useMemo(() => (positions ? getBoundingBoxSize(positions) : null), [positions]);
  const size = scene?.asset.dimensions ?? meshSize;
  const source = scene?.file ?? file;
  const format = scene?.format ?? (file ? getSourceFormat(file) : undefined);
  const exceedsEditingLimits =
    format === '3mf' &&
    currentModel &&
    (currentModel.indices.length / 3 > DEFAULT_MESH_GEOMETRY_LIMITS.maxTriangles ||
      currentModel.positions.length / 3 > DEFAULT_MESH_GEOMETRY_LIMITS.maxVertices);
  const assumedUnits = format === 'stl' || format === 'obj' || format === 'ply' || format === 'brep';
  const dimensions = new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 });
  const error = viewerError ? t(viewerError.message, viewerError.params) : importError && translate3DMessage(importError, t);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="three-viewer">
      <div className={styles.workspace}>
        {source && size && (scene || currentModel) ? (
          <>
            <div className={styles.modelHeader}>
              <h2 className={styles.modelName}>{currentModel?.name || source.name}</h2>
              <Button variant="secondary" size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={clearViewer}>
                {t('Choose another file')}
              </Button>
            </div>

            {scene ? (
              <MeshViewer model={null} sceneAsset={scene.asset} advanced className={styles.viewport} />
            ) : (
              <MeshViewer model={currentModel} advanced className={styles.viewport} />
            )}

            <dl className={styles.diagnostics}>
              <div>
                <dt>{t('Source format')}</dt>
                <dd>{format?.toUpperCase() ?? t('Unknown Format')}</dd>
              </div>
              <div>
                <dt>{t('File size')}</dt>
                <dd>{formatBytes(source.size)}</dd>
              </div>
              <div>
                <dt>{t('Triangles')}</dt>
                <dd>{(scene?.asset.triangles ?? (currentModel?.indices.length ?? 0) / 3).toLocaleString(locale)}</dd>
              </div>
              <div>
                <dt>{t('Vertices')}</dt>
                <dd>{(scene?.asset.vertices ?? (currentModel?.positions.length ?? 0) / 3).toLocaleString(locale)}</dd>
              </div>
              {scene && (
                <>
                  <div>
                    <dt>{t('Meshes')}</dt>
                    <dd>{scene.asset.meshes.toLocaleString(locale)}</dd>
                  </div>
                  <div>
                    <dt>{t('Materials')}</dt>
                    <dd>{scene.asset.materials.toLocaleString(locale)}</dd>
                  </div>
                  <div>
                    <dt>{t('Textures')}</dt>
                    <dd>{scene.asset.textures.toLocaleString(locale)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>{t('Size (X × Y × Z)')}</dt>
                <dd>{size.map((value) => dimensions.format(value)).join(' × ')}</dd>
                {format && (
                  <dd className={styles.unitNote}>
                    {scene ? t('Meters (Y-up)') : assumedUnits ? t('Unitless source (mm assumed)') : t('Normalized to millimeters (mm)')}
                  </dd>
                )}
              </div>
            </dl>

            {!scene && <WorkbenchWarnings warnings={currentModel?.warnings} />}
            {!scene && !exceedsEditingLimits && <ContinueWith results={[{ name: source.name, blob: source }]} />}
          </>
        ) : loading || loadingScene ? (
          <div className={styles.importProgress}>
            <div className={styles.importStatus} role="status">
              <span className="spinner" aria-hidden="true" />
              {t('Loading 3D model...')}
            </div>
            <Button variant="secondary" size="sm" onClick={cancelImport}>
              {t('Cancel import')}
            </Button>
          </div>
        ) : (
          <>
            <FileDrop
              accept={VIEWER_ACCEPT}
              multiple
              label={t('Choose a model or CAD file')}
              hint={t('Open STL, OBJ, PLY, 3MF, STEP, IGES, BREP, GLB, or glTF. Select any companion BIN or texture files with the scene.')}
              onFiles={openFiles}
            />
            <input
              ref={folderInput}
              type="file"
              {...{ webkitdirectory: '' }}
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                openFolder(files);
              }}
            />
            <Button variant="secondary" size="sm" className={styles.folderAction} onClick={() => folderInput.current?.click()}>
              {t('Open scene folder')}
            </Button>
            {sceneFolder && (
              <form
                className={styles.scenePicker}
                onSubmit={(event) => {
                  event.preventDefault();
                  const path = new FormData(event.currentTarget).get('scene');
                  const selected = sceneFolder.scenes.find((candidate) => candidate.webkitRelativePath === path);
                  if (selected) openFolderScene(selected, sceneFolder.files);
                }}
              >
                <Field label={t('Scene in this folder')}>
                  <Select
                    name="scene"
                    options={sceneFolder.scenes.map(({ webkitRelativePath }) => ({
                      value: webkitRelativePath,
                      label: webkitRelativePath,
                    }))}
                  />
                </Field>
                <Button type="submit" variant="secondary" size="sm">
                  {t('Open scene')}
                </Button>
              </form>
            )}
          </>
        )}

        {error && (
          <Alert tone="danger" title={t('Could not open model')}>
            {error}
          </Alert>
        )}
        {processError && <p role="status">{translate3DMessage(processError, t)}</p>}
      </div>
    </ToolPage>
  );
}
