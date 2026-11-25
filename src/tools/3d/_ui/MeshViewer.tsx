import { lazy, Suspense } from 'react';
import type { MeshModel } from './types';
import type { LocalSceneAsset } from '../viewer/gltf';
import styles from './MeshViewer.module.css';
import { useI18n } from '../../../lib/i18n';

export interface MeshViewerProps {
  model: MeshModel | null;
  sceneAsset?: LocalSceneAsset | null;
  className?: string;
  advanced?: boolean;
}

const LazyMeshCanvas = lazy(() => import('./MeshCanvas'));

export function MeshViewer({ model, sceneAsset, className, advanced = false }: MeshViewerProps) {
  const { t } = useI18n();
  const containerClassName = [styles.viewerContainer, advanced && styles.advancedViewer, className].filter(Boolean).join(' ');
  if (!model && !sceneAsset) {
    return <div className={containerClassName} />;
  }

  return (
    <Suspense
      fallback={
        <div className={containerClassName}>
          <div className={styles.loadingSpinner}>
            <span className="spinner" aria-hidden="true" />
            <span>{t('Initializing 3D Viewport...')}</span>
          </div>
        </div>
      }
    >
      <LazyMeshCanvas model={model} sceneAsset={sceneAsset} className={containerClassName} advanced={advanced} />
    </Suspense>
  );
}
