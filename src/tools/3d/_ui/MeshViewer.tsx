import { lazy, Suspense } from 'react';
import type { MeshModel } from './types';
import styles from './MeshViewer.module.css';
import { useI18n } from '../../../lib/i18n';

export interface MeshViewerProps {
  model: MeshModel | null;
  className?: string;
}

const LazyMeshCanvas = lazy(() => import('./MeshCanvas'));

export function MeshViewer({ model, className }: MeshViewerProps) {
  const { t } = useI18n();
  if (!model) {
    return <div className={`${styles.viewerContainer} ${className || ''}`} />;
  }

  return (
    <Suspense
      fallback={
        <div className={`${styles.viewerContainer} ${className || ''}`}>
          <div className={styles.loadingSpinner}>
            <span className="spinner" aria-hidden="true" />
            <span>{t('Initializing 3D Viewport...')}</span>
          </div>
        </div>
      }
    >
      <LazyMeshCanvas model={model} className={className} />
    </Suspense>
  );
}
