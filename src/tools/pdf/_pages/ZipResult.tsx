import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { Button } from '../../../components/Controls';
import { useI18n } from '../../../lib/i18n';

export interface ZipResultProps {
  zip: Blob;
  zipName: string;
  items: { name: string; blob: Blob }[];
  onReset: () => void;
}

/** Lists the files inside a freshly built ZIP and offers each file or the whole archive for download. */
export function ZipResult({ zip, zipName, items, onReset }: ZipResultProps) {
  const { t } = useI18n();
  return (
    <div className="batch-results">
      <ul className="batch-list">
        {items.map((item) => (
          <li className="batch-item" key={item.name}>
            <div className="batch-thumb batch-thumb-fallback" aria-hidden="true">
              📄
            </div>
            <div className="batch-info">
              <div className="batch-name" title={item.name}>
                {item.name}
              </div>
              <div className="batch-meta">{formatBytes(item.blob.size)}</div>
            </div>
            <Button
              variant="secondary"
              onClick={() => downloadBlob(item.blob, item.name)}
              aria-label={t('Download {filename}', { filename: item.name })}
            >
              {t('Download')}
            </Button>
          </li>
        ))}
      </ul>

      <div className="batch-actions">
        <Button variant="secondary" onClick={onReset}>
          {t('Start over')}
        </Button>
        <span className="batch-name" title={zipName}>
          {zipName}
        </span>
        <Button variant="primary" onClick={() => downloadBlob(zip, zipName)} aria-label={t('Download {filename}', { filename: zipName })}>
          {t('Download')}
        </Button>
      </div>
    </div>
  );
}
