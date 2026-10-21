import { lazy, Suspense } from 'react';
import type { MeshModel } from './types';
import styles from './MeshViewer.module.css';

export interface MeshViewerProps {
  model: MeshModel | null;
  className?: string;
}

const LazyMeshCanvas = lazy(() => import('./MeshCanvas'));

export function MeshViewer({ model, className }: MeshViewerProps) {
  if (!model) {
    return <div className={`${styles.viewerContainer} ${className || ''}`} />;
  }

  return (
    <Suspense
      fallback={
        <div className={`${styles.viewerContainer} ${className || ''}`}>
          <div className={styles.loadingSpinner}>
            <span className="spinner" aria-hidden="true" />
            <span>Initializing 3D Viewport...</span>
          </div>
        </div>
      }
    >
      <LazyMeshCanvas model={model} className={className} />
    </Suspense>
  );
}
