import type { ReactNode } from 'react';
import { Button } from '../../../components/Controls';
import { ProgressBar } from '../../../components/ProgressBar';
import { formatBytes } from '../../../lib/format';
import type { UseJobReturn } from '../../../lib/useJob';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import styles from './ConvertPanel.module.css';
import { useI18n } from '../../../lib/i18n';

export interface ConvertPanelProps {
  /** Chips describing the loaded source, such as its file name. */
  chips: ReactNode;
  job: UseJobReturn;
  pageCount?: number;
  outName: string;
  /** Source size for the size comparison in the result. */
  sourceSize?: number;
  actionLabel: string;
  actionDisabled?: boolean;
  progressLabel: string;
  changeLabel: string;
  /** Set when the source could not be read. */
  loadError?: string;
  onConvert: () => void;
  onReset: () => void;
  /** Settings fields, laid out in a grid. */
  children?: ReactNode;
  /** Extra content shown between settings and the action buttons. */
  preview?: ReactNode;
}

export function ConvertPanel({
  chips,
  job,
  pageCount,
  outName,
  sourceSize,
  actionLabel,
  actionDisabled,
  progressLabel,
  changeLabel,
  loadError,
  onConvert,
  onReset,
  children,
  preview,
}: ConvertPanelProps) {
  const { t } = useI18n();
  return (
    <div>
      {loadError && <div className="error-banner">{t(loadError)}</div>}
      {job.error && <div className="error-banner">{t(job.error)}</div>}

      {job.result ? (
        <PdfPreview blob={job.result} filename={outName} originalSize={sourceSize} pageCount={pageCount} onReset={onReset} />
      ) : (
        <div>
          <div className={styles.topRow}>
            <div className="meta-chips">{chips}</div>
            <Button variant="secondary" onClick={onReset}>
              {changeLabel}
            </Button>
          </div>

          {children && <div className={styles.controls}>{children}</div>}
          {preview}

          {job.status === 'running' ? (
            <ProgressBar value={job.progress} label={progressLabel} />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="primary" onClick={onConvert} disabled={actionDisabled}>
                {actionLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileChips({ file }: { file: File }) {
  const { t } = useI18n();
  return (
    <>
      <span className="meta-chip">
        {t('File:')} <strong>{file.name}</strong>
      </span>
      <span className="meta-chip">
        {t('Size:')} <strong>{formatBytes(file.size)}</strong>
      </span>
    </>
  );
}
