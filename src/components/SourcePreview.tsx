import { useState } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useI18n } from '../lib/i18n';
import styles from './SourcePreview.module.css';

interface SourcePreviewProps {
  file: File;
  kind?: 'video' | 'audio';
  note: string;
}

export function SourcePreview({ file, kind = file.type.startsWith('audio/') ? 'audio' : 'video', note }: SourcePreviewProps) {
  const { t } = useI18n();
  const url = useObjectUrl(file);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const failed = failedFile === file;
  const loaded = loadedFile === file;

  return (
    <section className={styles.preview} aria-label={t('Source preview')}>
      <div className={styles.heading}>{t('Source preview')}</div>
      {url ? (
        kind === 'audio' ? (
          <audio
            controls
            preload="metadata"
            src={url}
            className={styles.audio}
            aria-label={t('Source preview')}
            onLoadedMetadata={() => setLoadedFile(file)}
            onError={() => setFailedFile(file)}
          />
        ) : (
          <video
            controls
            playsInline
            preload="metadata"
            src={url}
            className={styles.video}
            aria-label={t('Source preview')}
            onLoadedMetadata={() => setLoadedFile(file)}
            onError={() => setFailedFile(file)}
          />
        )
      ) : (
        <p className={styles.status} role="status">
          {t('Preparing source preview...')}
        </p>
      )}
      {url && !loaded && !failed && (
        <p className={styles.status} role="status">
          {t('Loading source preview...')}
        </p>
      )}
      {failed && (
        <p className={styles.status} role="status">
          {t('The browser could not play this source file.')}
        </p>
      )}
      <p className={styles.note}>{t(note)}</p>
    </section>
  );
}
