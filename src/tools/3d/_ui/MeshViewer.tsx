import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshModel } from './types';
import { Alert } from '../../../components/Controls';
import { Box, Eye, Maximize2 } from 'lucide-react';
import styles from './MeshViewer.module.css';

export interface MeshViewerProps {
  model: MeshModel | null;
  className?: string;
}

function checkWebGL2(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGL2RenderingContext &&
      canvas.getContext('webgl2')
    );
  } catch {
    return false;
  }
}

export function MeshViewer({ model, className }: MeshViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [hasWebGL] = useState<boolean>(() => checkWebGL2());
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // References for three.js instances so buttons can interact
  const fitCameraRef = useRef<(() => void) | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const currentMeshRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null>(null);
  const currentGridRef = useRef<THREE.GridHelper | null>(null);
  const wireframeRef = useRef<boolean>(wireframe);
  wireframeRef.current = wireframe;

  // Toggle wireframe on active material
  const toggleWireframe = useCallback(() => {
    setWireframe((prev) => {
      const next = !prev;
      if (materialRef.current) {
        materialRef.current.wireframe = next;
      }
      return next;
    });
  }, []);

  const triggerFit = useCallback(() => {
    if (fitCameraRef.current) {
      fitCameraRef.current();
    }
  }, []);

  // 1. Initialize Three.js viewport (renderer, scene, camera, controls, lights) once
  useEffect(() => {
    if (!hasWebGL) {
      setLoading(false);
      return;
    }

    const container = canvasRef.current;
    if (!container) return;

    let animId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 440;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      // Z-up coordinate system matching engine
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.up.set(0, 0, 1);
      camera.position.set(100, -150, 100);
      cameraRef.current = camera;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.replaceChildren(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.enableRotate = true;
      controlsRef.current = controls;

      // Procedural local lighting in Z-up
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
      keyLight.position.set(10, -15, 20).normalize();
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.5);
      fillLight.position.set(-10, 15, -10).normalize();
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
      rimLight.position.set(0, -15, 10).normalize();
      scene.add(rimLight);

      // ResizeObserver
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0 && renderer && camera) {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
          }
        }
      });
      resizeObserver.observe(container);

      // Render animation loop
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls?.update();
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      };
      animate();

      setLoading(false);
    } catch (err: unknown) {
      console.warn('3D Viewer initialization error:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver?.disconnect();
      fitCameraRef.current = null;
      materialRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;

      if (controls) {
        controls.dispose();
      }

      if (currentMeshRef.current) {
        currentMeshRef.current.geometry.dispose();
        currentMeshRef.current.material.dispose();
        currentMeshRef.current = null;
      }

      if (currentGridRef.current) {
        const grid = currentGridRef.current;
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) {
          grid.material.forEach((m) => m.dispose());
        } else {
          grid.material.dispose();
        }
        currentGridRef.current = null;
      }

      if (renderer) {
        renderer.dispose();
        try {
          renderer.forceContextLoss?.();
        } catch {
          // ignore
        }
        if (renderer.domElement?.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
      }
    };
  }, [hasWebGL]);

  // 2. Synchronize model geometry with the scene
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    // Dispose existing mesh
    if (currentMeshRef.current) {
      scene.remove(currentMeshRef.current);
      currentMeshRef.current.geometry.dispose();
      currentMeshRef.current.material.dispose();
      currentMeshRef.current = null;
      materialRef.current = null;
    }

    // Dispose existing grid
    if (currentGridRef.current) {
      scene.remove(currentGridRef.current);
      const grid = currentGridRef.current;
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((m) => m.dispose());
      } else {
        grid.material.dispose();
      }
      currentGridRef.current = null;
    }

    if (!model || model.positions.length === 0 || model.indices.length === 0) {
      fitCameraRef.current = null;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(model.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: 0x6366f1, // indigo accent
      roughness: 0.35,
      metalness: 0.15,
      side: THREE.DoubleSide,
      wireframe: wireframeRef.current,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    currentMeshRef.current = mesh;

    // Grid floor at bottom of bounding box (XY plane with Z-up)
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 10);
    const grid = new THREE.GridHelper(maxDim * 2.2, 20, 0x6366f1, 0x475569);
    grid.rotation.x = Math.PI / 2; // Lie in XY plane
    const center = box.getCenter(new THREE.Vector3());
    grid.position.set(center.x, center.y, box.min.z);
    scene.add(grid);
    currentGridRef.current = grid;

    // Fit function in Z-up
    const fitToModel = () => {
      const currentBox = new THREE.Box3().setFromObject(mesh);
      if (currentBox.isEmpty()) return;

      const sphere = new THREE.Sphere();
      currentBox.getBoundingSphere(sphere);
      const radius = Math.max(sphere.radius, 0.1);
      const fov = (camera.fov * Math.PI) / 180;
      let distance = radius / Math.sin(fov / 2);
      distance *= 1.35; // Comfortable framing padding

      camera.near = Math.max(radius / 100, 0.01);
      camera.far = Math.max(radius * 100, 1000);
      camera.updateProjectionMatrix();

      // Z-up: X is right, Y is back/front, Z is up
      camera.position.set(
        sphere.center.x + distance * 0.7,
        sphere.center.y - distance * 0.7,
        sphere.center.z + distance * 0.55
      );
      controls.target.copy(sphere.center);
      controls.update();
    };

    fitCameraRef.current = fitToModel;
    fitToModel();
  }, [model]);

  // Synchronize wireframe state changes without rebuilding scene or resetting camera
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.wireframe = wireframe;
    }
  }, [wireframe]);

  const vertCount = model ? model.positions.length / 3 : 0;
  const triCount = model ? model.indices.length / 3 : 0;

  return (
    <div className={`${styles.viewerContainer} ${className || ''}`} ref={containerRef}>
      {!hasWebGL ? (
        <div className={styles.fallbackNotice}>
          <Alert tone="warning" title="WebGL 2 Unavailable">
            Hardware-accelerated 3D rendering (WebGL 2.0) is not available in your browser or device. You can still inspect,
            process, and convert models using the controls below.
          </Alert>
        </div>
      ) : loadError ? (
        <div className={styles.fallbackNotice}>
          <Alert tone="danger" title="Viewer Error">
            {loadError}
          </Alert>
        </div>
      ) : (
        <>
          <div className={styles.canvasWrapper}><div className={styles.canvasHost} ref={canvasRef} />
            {loading && (
              <div className={styles.loadingSpinner}>
                <span className="spinner" aria-hidden="true" />
                <span>Initializing 3D Viewport...</span>
              </div>
            )}
          </div>

          {model && !loading && (
            <>
              <div className={styles.toolbar} role="toolbar" aria-label="3D Viewport Controls">
                <button
                  type="button"
                  className={`${styles.toolbarBtn} ${wireframe ? styles.toolbarBtnActive : ''}`}
                  onClick={toggleWireframe}
                  title="Toggle wireframe mode"
                  aria-pressed={wireframe}
                >
                  <Eye size={14} aria-hidden="true" />
                  <span>Wireframe</span>
                </button>
                <button
                  type="button"
                  className={styles.toolbarBtn}
                  onClick={triggerFit}
                  title="Fit model to view"
                >
                  <Maximize2 size={14} aria-hidden="true" />
                  <span>Fit</span>
                </button>
              </div>

              <div className={styles.overlayStats}>
                <span>
                  <Box size={13} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} aria-hidden="true" />
                  <strong>{triCount.toLocaleString()}</strong> triangles
                </span>
                <span>•</span>
                <span>
                  <strong>{vertCount.toLocaleString()}</strong> vertices
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
