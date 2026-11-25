import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatNumber } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { zipFiles } from '../lib/zip';
import { Download, File as FileIcon, FolderDown, RotateCcw } from 'lucide-react';
import { Button } from './Controls';
import { useFocusFallback } from './useFocusFallback';
import { ContinueWith } from './ContinueWith';
import { useI18n } from '../lib/i18n';

export interface BatchResultItem {
  name: string;
  blob: Blob;
  originalSize?: number;
}

export interface BatchResultsProps {
  items: BatchResultItem[];
  onReset: () => void;
}

function BatchRow({ item }: { item: BatchResultItem }) {
  const { t } = useI18n();
  const isImage = item.blob.type.startsWith('image/');
  const url = useObjectUrl(isImage ? item.blob : undefined);

  let change: { label: string; className: string } | null = null;
  if (item.originalSize && item.originalSize > 0) {
    const percent = Math.round(((item.blob.size - item.originalSize) / item.originalSize) * 100);
    change =
      percent <= 0
        ? { label: t('{percent}% smaller', { percent: formatNumber(Math.abs(percent)) }), className: 'batch-delta-smaller' }
        : { label: t('+{percent}% larger', { percent: formatNumber(percent) }), className: 'batch-delta-larger' };
  }

  return (
    <li className="batch-item">
      {url ? (
        <img src={url} alt="" className="batch-thumb" />
      ) : (
        <div className="batch-thumb batch-thumb-fallback" aria-hidden="true">
          <FileIcon />
        </div>
      )}

      <div className="batch-info">
        <div className="batch-name" title={item.name}>
          {item.name}
        </div>
        <div className="batch-meta">
          {item.originalSize !== undefined && <>{formatBytes(item.originalSize)} → </>}
          {formatBytes(item.blob.size)}
          {change && (
            <>
              {' · '}
              <span className={change.className}>{change.label}</span>
            </>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        icon={<Download />}
        aria-label={t('Download {file}', { file: item.name })}
        onClick={() => downloadBlob(item.blob, item.name)}
      >
        {t('Save')}
      </Button>
    </li>
  );
}

export function BatchResults({ items, onReset }: BatchResultsProps) {
  const { t } = useI18n();
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusFallback(panelRef);

  // The button that started the batch has left the page; move focus here so the outcome is announced.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  async function downloadAll() {
    setZipping(true);
    setError(null);
    try {
      const zip = await zipFiles(items.map(({ name, blob }) => ({ name, blob })));
      downloadBlob(zip, 'loconvert-images.zip');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not create the ZIP file.'));
    } finally {
      setZipping(false);
    }
  }

  return (
    <div
      className="batch-results"
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={items.length === 1 ? t('Results: one file ready') : t('Results: {count} files ready', { count: items.length })}
    >
      <ul className="batch-list">
        {items.map((item, index) => (
          <BatchRow key={`${item.name}-${index}`} item={item} />
        ))}
      </ul>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="batch-actions">
        <ContinueWith results={items} />
        <Button variant="ghost" icon={<RotateCcw />} onClick={onReset}>
          {t('Start over')}
        </Button>
        <Button variant="primary" size="lg" icon={<FolderDown />} loading={zipping} onClick={downloadAll} disabled={items.length === 0}>
          {zipping ? t('Zipping…') : t('Download all {count} (.zip)', { count: items.length })}
        </Button>
      </div>
    </div>
  );
}
