import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Eye, Hand, Maximize2, Minus, Orbit, Plus } from 'lucide-react';
import type { LocalSceneAsset } from '../viewer/gltf';
import { Alert } from '../../../components/Controls';
import { useI18n } from '../../../lib/i18n';
import type { MeshModel } from './types';
import styles from './MeshViewer.module.css';

interface MeshCanvasProps {
  model: MeshModel | null;
  sceneAsset?: LocalSceneAsset | null;
  className: string;
  advanced: boolean;
}

type ViewportStatus = 'loading' | 'ready' | 'unavailable' | 'lost' | 'error';
type RenderMode = 'solid' | 'wireframe' | 'normals';
type DragMode = 'orbit' | 'pan';
type Environment = 'studio' | 'daylight' | 'warm';
type Pose = { position: [string, string, string]; rotation: [string, string, string] };

const defaultPose: Pose = { position: ['0', '0', '0'], rotation: ['0', '0', '0'] };
const axes = ['X', 'Y', 'Z'] as const;
const viewDirections = {
  isometric: new THREE.Vector3(0.7, -0.7, 0.55),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, -0.00001, 1),
  bottom: new THREE.Vector3(0, -0.00001, -1),
};
const environments = {
  studio: { key: 0xffffff, fill: 0x94a3b8, ambient: 0.65, reflection: 0.7, rotation: 0 },
  daylight: { key: 0xe1edff, fill: 0xb2cbfa, ambient: 0.85, reflection: 1, rotation: Math.PI / 2 },
  warm: { key: 0xffcb8d, fill: 0xb4a2d0, ambient: 0.4, reflection: 0.45, rotation: Math.PI },
};

function createViewport(host: HTMLDivElement, advanced: boolean, setStatus: (status: ViewportStatus) => void) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    setStatus('unavailable');
    return;
  }

  const canvas = renderer.domElement;
  host.append(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if (advanced) renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45);
  camera.up.set(0, 0, 1);
  camera.position.copy(viewDirections.isometric);
  const controls = new OrbitControls(camera, canvas);
  if (advanced) controls.cursorStyle = 'grab';

  const pivot = new THREE.Group();
  const source = new THREE.Group();
  pivot.add(source);

  const grid = new THREE.GridHelper(2.2, 20, advanced ? 0x646c71 : 0x6366f1, advanced ? 0x41494e : 0x475569);
  grid.rotation.x = Math.PI / 2;
  const axisHelper = new THREE.AxesHelper(1);
  const guides = new THREE.Group();
  guides.add(grid, axisHelper);

  const ambient = new THREE.AmbientLight(0xffffff);
  const key = new THREE.DirectionalLight(0xffffff);
  const fill = new THREE.DirectionalLight(0x94a3b8, 0.5);
  fill.position.set(-10, 15, -10);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(0, -15, 10);
  scene.add(pivot, guides, ambient, key, fill, rim);

  const solid = new THREE.MeshStandardMaterial({
    color: advanced ? 0x9eabc3 : 0x6366f1,
    roughness: 0.35,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const wireframe = advanced ? new THREE.MeshBasicMaterial({ color: 0xc4d0e2, side: THREE.DoubleSide }) : solid.clone();
  wireframe.wireframe = true;
  const normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const flatNormals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, flatShading: true });
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const sourceCenter = new THREE.Vector3();
  let ownedGeometry: THREE.BufferGeometry | undefined;
  let renderMode: RenderMode = 'solid';

  let frame = 0;
  let paused = false;
  let failed = false;
  let environmentMap: THREE.WebGLRenderTarget | undefined;

  function requestRender() {
    if (frame || paused || failed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        if (advanced && !environmentMap) {
          const room = new RoomEnvironment();
          const pmrem = new THREE.PMREMGenerator(renderer);
          try {
            environmentMap = pmrem.fromScene(room);
            scene.environment = environmentMap.texture;
          } finally {
            pmrem.dispose();
            room.dispose();
          }
        }
        renderer.render(scene, camera);
      } catch (error) {
        if (renderer.getContext().isContextLost()) return;
        failed = true;
        controls.enabled = false;
        console.warn('3D Viewer render error:', error);
        setStatus('error');
      }
    });
  }

  function resize() {
    const width = host.clientWidth || 600;
    const height = host.clientHeight || 440;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }

  function contextLost(event: Event) {
    event.preventDefault();
    paused = true;
    controls.enabled = false;
    cancelAnimationFrame(frame);
    frame = 0;
    setStatus('lost');
  }

  function contextRestored() {
    environmentMap?.dispose();
    environmentMap = undefined;
    scene.environment = null;
    paused = false;
    failed = false;
    controls.enabled = true;
    setStatus('ready');
    requestRender();
  }

  // OrbitControls' change threshold uses absolute world units. Draw input
  // updates even when camera motion is smaller than that threshold.
  function drawPointerMove(event: PointerEvent) {
    if (event.buttons || event.pointerType === 'touch') requestRender();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  canvas.addEventListener('pointermove', drawPointerMove);
  canvas.addEventListener('wheel', requestRender, { passive: true });
  controls.addEventListener('change', requestRender);
  resize();

  function fit(direction = camera.position.clone().sub(controls.target)) {
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return;
    const { center, radius: boundsRadius } = box.getBoundingSphere(new THREE.Sphere());
    const radius = boundsRadius || 1;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = (1.2 * radius) / Math.sin(Math.min(horizontal, vertical));

    camera.near = radius / 500;
    camera.far = Math.max(radius * 300, distance * 3);
    controls.minDistance = radius / 50;
    controls.maxDistance = camera.far / 2;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction.clone().normalize(), distance);
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  function applyRenderMode() {
    for (const [mesh, original] of originalMaterials) {
      const override =
        renderMode === 'wireframe'
          ? wireframe
          : renderMode === 'normals'
            ? mesh.geometry.hasAttribute('normal')
              ? normals
              : flatNormals
            : null;
      mesh.material = override && Array.isArray(original) ? original.map(() => override) : (override ?? original);
    }
    requestRender();
  }

  function clearContent() {
    for (const [mesh, material] of originalMaterials) mesh.material = material;
    originalMaterials.clear();
    source.clear();
    ownedGeometry?.dispose();
    ownedGeometry = undefined;
  }

  return {
    controls,
    fit,
    requestRender,
    setContent(positions: MeshModel['positions'] | undefined, indices: MeshModel['indices'] | undefined, root: THREE.Group | undefined) {
      clearContent();
      if (failed && !paused) {
        failed = false;
        controls.enabled = true;
        setStatus('ready');
      }
      pivot.position.set(0, 0, 0);
      pivot.rotation.set(0, 0, 0);
      source.position.set(0, 0, 0);
      source.rotation.x = root ? Math.PI / 2 : 0;
      if (root) {
        source.add(root);
      } else if (positions?.length && indices?.length) {
        ownedGeometry = new THREE.BufferGeometry();
        ownedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        ownedGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
        ownedGeometry.computeVertexNormals();
        source.add(new THREE.Mesh(ownedGeometry, solid));
      }

      source.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) originalMaterials.set(mesh, mesh.material);
      });

      // Measuring the source subtree does not update its parent transform.
      pivot.updateWorldMatrix(true, false);
      const bounds = new THREE.Box3().setFromObject(source);
      guides.visible = !bounds.isEmpty();
      if (guides.visible) {
        bounds.getCenter(sourceCenter);
        source.position.copy(sourceCenter).negate();
        pivot.position.copy(sourceCenter);
        const { x, y, z } = bounds.getSize(new THREE.Vector3());
        const size = Math.max(x, y, z) || 1;
        guides.position.set(sourceCenter.x, sourceCenter.y, bounds.min.z);
        grid.scale.setScalar(advanced ? size : Math.max(size, 10));
        axisHelper.scale.setScalar(size * 0.6);
        fit(viewDirections.isometric);
      } else {
        sourceCenter.set(0, 0, 0);
      }
      applyRenderMode();
    },
    setPose(pose: Pose) {
      const [x, y, z] = pose.position.map(Number);
      pivot.position.copy(sourceCenter).add(new THREE.Vector3(x, y, z));
      const [rx, ry, rz] = pose.rotation.map((value) => THREE.MathUtils.degToRad(Number(value) % 360));
      pivot.rotation.set(rx, ry, rz);
      requestRender();
    },
    setAppearance(mode: RenderMode, environment: Environment, intensity: number, direction: number, showGrid: boolean, showAxes: boolean) {
      if (renderMode !== mode) {
        renderMode = mode;
        applyRenderMode();
      }

      const lighting = environments[environment];
      const angle = THREE.MathUtils.degToRad(direction);
      ambient.intensity = lighting.ambient * intensity;
      key.color.setHex(lighting.key);
      key.intensity = 0.85 * intensity;
      key.position.set(Math.cos(angle), Math.sin(angle), 1.1);
      fill.color.setHex(lighting.fill);
      fill.intensity = 0.5 * intensity;
      rim.intensity = 0.35 * intensity;
      scene.environmentIntensity = lighting.reflection * intensity;
      scene.environmentRotation.set(Math.PI / 2, 0, lighting.rotation, 'ZXY');
      grid.visible = showGrid;
      axisHelper.visible = showAxes;
      requestRender();
    },
    dispose() {
      paused = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      canvas.removeEventListener('pointermove', drawPointerMove);
      canvas.removeEventListener('wheel', requestRender);
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      clearContent();
      grid.dispose();
      axisHelper.dispose();
      solid.dispose();
      wireframe.dispose();
      normals.dispose();
      flatNormals.dispose();
      environmentMap?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export function MeshCanvas({ model, sceneAsset, className, advanced }: MeshCanvasProps) {
  const { t, locale } = useI18n();
  const intensityId = useId();
  const directionId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ReturnType<typeof createViewport>>(undefined);
  const [status, setStatus] = useState<ViewportStatus>('loading');
  const [drag, setDrag] = useState<DragMode>('orbit');
  const [view, setView] = useState<keyof typeof viewDirections | ''>('');
  const [mode, setMode] = useState<RenderMode>('solid');
  const [environment, setEnvironment] = useState<Environment>('studio');
  const [intensity, setIntensity] = useState(100);
  const [direction, setDirection] = useState(304);
  const [grid, setGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);

  const positions = model?.positions;
  const indices = model?.indices;
  const root = sceneAsset?.root;
  const [poseState, setPoseState] = useState({ positions, indices, root, pose: defaultPose });
  const pose = poseState.positions === positions && poseState.indices === indices && poseState.root === root ? poseState.pose : defaultPose;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const viewport = createViewport(host, advanced, setStatus);
    viewportRef.current = viewport;
    if (viewport) setStatus('ready');
    return () => {
      viewportRef.current = undefined;
      viewport?.dispose();
    };
  }, [advanced]);

  useEffect(() => {
    viewportRef.current?.setContent(positions, indices, root);
    setView('isometric');
  }, [positions, indices, root, advanced]);

  useEffect(() => {
    viewportRef.current?.setPose(pose);
  }, [pose, positions, indices, root, advanced]);

  useEffect(() => {
    viewportRef.current?.setAppearance(mode, environment, intensity / 100, direction, grid, advanced && showAxes);
  }, [mode, environment, intensity, direction, grid, advanced, showAxes]);

  useEffect(() => {
    const controls = viewportRef.current?.controls;
    if (!controls) return;
    controls.mouseButtons.LEFT = drag === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = drag === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }, [drag, advanced]);

  useEffect(() => {
    const controls = viewportRef.current?.controls;
    if (!controls || !advanced) return;
    const clearView = () => setView('');
    controls.addEventListener('start', clearView);
    return () => controls.removeEventListener('start', clearView);
  }, [advanced]);

  function changePose(kind: keyof Pose, axis: number, value: string) {
    const values: Pose[typeof kind] = [...pose[kind]];
    values[axis] = value;
    setPoseState({ positions, indices, root, pose: { ...pose, [kind]: values } });
  }

  function zoom(inward: boolean) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (inward) viewport.controls.dollyIn(0.8);
    else viewport.controls.dollyOut(0.8);
    viewport.requestRender();
  }

  function handleViewportKey(event: KeyboardEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (status !== 'ready' || !viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    const { controls } = viewport;

    if (event.key === '+' || event.key === '-' || event.key === '=') {
      event.preventDefault();
      zoom(event.key !== '-');
      return;
    }

    const x = Number(event.key === 'ArrowLeft') - Number(event.key === 'ArrowRight');
    const y = Number(event.key === 'ArrowUp') - Number(event.key === 'ArrowDown');
    if (x === 0 && y === 0) return;
    event.preventDefault();
    setView('');
    if (drag === 'pan') {
      controls.pan(x * 18, -y * 18);
    } else {
      if (x) controls.rotateLeft(x * 0.1);
      if (y) controls.rotateUp(y * 0.1);
    }
    viewport.requestRender();
  }

  const ready = status === 'ready';
  const triangles = sceneAsset?.triangles ?? (indices?.length ?? 0) / 3;
  const vertices = sceneAsset?.vertices ?? (positions?.length ?? 0) / 3;
  const fitButton = (
    <button type="button" className={styles.toolbarBtn} onClick={() => viewportRef.current?.fit()} title={t('Fit model to view')}>
      <Maximize2 size={14} aria-hidden="true" />
      {t('Fit')}
    </button>
  );

  return (
    <div className={className}>
      {ready && advanced && (
        <div className={styles.advancedToolbar} role="group" aria-label={t('3D Viewport Controls')}>
          <div className={styles.buttonGroup} role="group" aria-label={t('Camera drag mode')}>
            <button type="button" className={styles.toolbarBtn} aria-pressed={drag === 'orbit'} onClick={() => setDrag('orbit')}>
              <Orbit size={15} aria-hidden="true" />
              {t('Orbit')}
            </button>
            <button type="button" className={styles.toolbarBtn} aria-pressed={drag === 'pan'} onClick={() => setDrag('pan')}>
              <Hand size={15} aria-hidden="true" />
              {t('Pan')}
            </button>
          </div>
          <div className={styles.buttonGroup} role="group" aria-label={t('Zoom and fit')}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => zoom(false)}
              aria-label={t('Zoom out')}
              title={t('Zoom out')}
            >
              <Minus size={15} aria-hidden="true" />
            </button>
            <button type="button" className={styles.toolbarBtn} onClick={() => zoom(true)} aria-label={t('Zoom in')} title={t('Zoom in')}>
              <Plus size={15} aria-hidden="true" />
            </button>
            {fitButton}
          </div>
          <select
            aria-label={t('Camera view')}
            value={view}
            onChange={(event) => {
              const nextView = event.target.value as keyof typeof viewDirections;
              setView(nextView);
              viewportRef.current?.fit(viewDirections[nextView]);
            }}
          >
            <option value="" disabled>
              {t('Camera view')}
            </option>
            <option value="isometric">{t('Isometric')}</option>
            <option value="front">{t('Front')}</option>
            <option value="back">{t('Back')}</option>
            <option value="left">{t('Left')}</option>
            <option value="right">{t('Right')}</option>
            <option value="top">{t('Top')}</option>
            <option value="bottom">{t('Bottom')}</option>
          </select>
        </div>
      )}

      <div className={styles.canvasWrapper} data-environment={advanced ? environment : undefined}>
        <div
          className={styles.canvasHost}
          ref={hostRef}
          tabIndex={advanced && ready ? 0 : undefined}
          role={advanced ? 'group' : undefined}
          aria-label={advanced ? t('3D viewport. Use arrow keys to orbit or pan and plus or minus to zoom.') : undefined}
          onKeyDown={advanced ? handleViewportKey : undefined}
        />
        {status !== 'ready' && (
          <div className={styles.viewportNotice} role="status">
            {status === 'loading' ? (
              <div className={styles.loadingSpinner}>
                <span className="spinner" aria-hidden="true" />
                <span>{t('Initializing 3D Viewport...')}</span>
              </div>
            ) : status === 'unavailable' ? (
              <Alert tone="warning" title={t('WebGL 2 Unavailable')}>
                {advanced
                  ? t('Your browser or device does not support WebGL 2. You can still check the model details below.')
                  : t(
                      'Hardware-accelerated 3D rendering (WebGL 2.0) is not available in your browser or device. You can still inspect, process, and convert models using the controls below.',
                    )}
              </Alert>
            ) : status === 'lost' ? (
              <Alert tone="warning" title={t('WebGL Context Lost')}>
                {t('The viewport will resume when WebGL is restored. Reload the page if it stays unavailable.')}
              </Alert>
            ) : (
              <Alert tone="danger" title={t('Viewer Error')}>
                {t('The 3D viewport could not render this model.')}
              </Alert>
            )}
          </div>
        )}
        {ready && !advanced && (
          <div className={styles.toolbar} role="group" aria-label={t('3D Viewport Controls')}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => setMode(mode === 'wireframe' ? 'solid' : 'wireframe')}
              title={t('Toggle wireframe mode')}
              aria-pressed={mode === 'wireframe'}
            >
              <Eye size={14} aria-hidden="true" />
              {t('Wireframe')}
            </button>
            {fitButton}
          </div>
        )}
        {ready && (
          <div className={styles.overlayStats}>
            <Box size={13} aria-hidden="true" />
            <span>
              <strong>{triangles.toLocaleString(locale)}</strong> {t('triangles')}
            </span>
            <span>
              <strong>{vertices.toLocaleString(locale)}</strong> {t('vertices')}
            </span>
          </div>
        )}
      </div>

      {ready && advanced && (
        <div className={styles.settings}>
          <details>
            <summary>{t('View settings')}</summary>
            <div className={styles.settingsFields}>
              <label className={styles.field}>
                {t('Render mode')}
                <select value={mode} onChange={(event) => setMode(event.target.value as RenderMode)}>
                  <option value="solid">{t('Solid')}</option>
                  <option value="wireframe">{t('Wireframe')}</option>
                  <option value="normals">{t('Normals')}</option>
                </select>
              </label>
              <label className={styles.field}>
                {t('Environment')}
                <select value={environment} onChange={(event) => setEnvironment(event.target.value as Environment)}>
                  <option value="studio">{t('Studio')}</option>
                  <option value="daylight">{t('Daylight')}</option>
                  <option value="warm">{t('Warm')}</option>
                </select>
              </label>
              <div className={styles.field}>
                <span>
                  <label htmlFor={intensityId}>{t('Light intensity')}</label> <output>{intensity}%</output>
                </span>
                <input
                  id={intensityId}
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={intensity}
                  onChange={(event) => setIntensity(event.target.valueAsNumber)}
                />
              </div>
              <div className={styles.field}>
                <span>
                  <label htmlFor={directionId}>{t('Light direction')}</label> <output>{direction}°</output>
                </span>
                <input
                  id={directionId}
                  type="range"
                  min={0}
                  max={360}
                  value={direction}
                  onChange={(event) => setDirection(event.target.valueAsNumber)}
                />
              </div>
              <div className={styles.guideToggles}>
                <label>
                  <input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} />
                  {t('Grid')}
                </label>
                <label>
                  <input type="checkbox" checked={showAxes} onChange={(event) => setShowAxes(event.target.checked)} />
                  {t('Axes')}
                </label>
              </div>
            </div>
          </details>
          <details>
            <summary>{t('Preview pose')}</summary>
            <div className={styles.settingsFields}>
              {(['position', 'rotation'] as const).map((kind) => (
                <fieldset className={styles.poseFields} key={kind}>
                  <legend>{kind === 'position' ? t('Position offset') : t('Rotation (degrees)')}</legend>
                  {axes.map((axis, index) => (
                    <label className={styles.field} key={axis}>
                      {axis}
                      <input
                        type="number"
                        step="any"
                        value={pose[kind][index]}
                        onChange={(event) => changePose(kind, index, event.target.value)}
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
              <div className={styles.poseActions}>
                <button
                  type="button"
                  className={styles.toolbarBtn}
                  onClick={() => setPoseState({ positions, indices, root, pose: defaultPose })}
                >
                  {t('Reset pose')}
                </button>
                <p>{t('Pose uses Z-up viewport coordinates. Diagnostics use source coordinates.')}</p>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export default MeshCanvas;
