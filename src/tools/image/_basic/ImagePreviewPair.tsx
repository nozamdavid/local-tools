import type { ReactNode } from 'react';
import styles from './basic.module.css';

interface ImagePreviewPairProps {
  sourceUrl?: string;
  outputUrl?: string;
  sourceAlt: string;
  outputAlt: string;
  sourceLabel: string;
  outputLabel: string;
  note: string;
  pending?: boolean;
  pendingLabel?: string;
  sourcePending?: boolean;
  sourceUnavailable?: string;
  sourceDetails?: ReactNode;
  outputDetails?: ReactNode;
  outputUnavailable?: string;
}

export function ImagePreviewPair({
  sourceUrl,
  outputUrl,
  sourceAlt,
  outputAlt,
  sourceLabel,
  outputLabel,
  note,
  pending = false,
  pendingLabel,
  sourcePending = false,
  sourceUnavailable,
  sourceDetails,
  outputDetails,
  outputUnavailable,
}: ImagePreviewPairProps) {
  return (
    <section className={styles.previewComparison} aria-label={sourceLabel}>
      <figure className={styles.previewFigure}>
        <figcaption className={styles.previewCaption}>{sourceLabel}</figcaption>
        <div className={`${styles.previewFrame} checker`}>
          {sourceUrl ? (
            <img className={styles.previewImage} src={sourceUrl} alt={sourceAlt} />
          ) : (
            <span className={styles.previewStatus} role={sourcePending ? 'status' : undefined}>
              {sourcePending ? pendingLabel : sourceUnavailable || pendingLabel}
            </span>
          )}
        </div>
        {sourceDetails && <div className={styles.previewDetails}>{sourceDetails}</div>}
      </figure>
      <figure className={styles.previewFigure}>
        <figcaption className={styles.previewCaption}>{outputLabel}</figcaption>
        <div className={`${styles.previewFrame} checker`}>
          {pending ? (
            <span className={styles.previewStatus} role="status">
              {pendingLabel}
            </span>
          ) : outputUrl ? (
            <img className={styles.previewImage} src={outputUrl} alt={outputAlt} />
          ) : (
            <span className={styles.previewStatus}>{outputUnavailable || pendingLabel}</span>
          )}
        </div>
        {outputDetails && <div className={styles.previewDetails}>{outputDetails}</div>}
      </figure>
      <p className={styles.previewNote}>{note}</p>
    </section>
  );
}
