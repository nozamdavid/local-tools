import { useState } from 'react';
import { formatBytes } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { zipFiles } from '../lib/zip';
import { Button } from './Controls';

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
  const isImage = item.blob.type.startsWith('image/');
  const url = useObjectUrl(isImage ? item.blob : undefined);

  let change: { percent: number; label: string; className: string } | null = null;
  if (item.originalSize && item.originalSize > 0) {
    const percent = Math.round(((item.blob.size - item.originalSize) / item.originalSize) * 100);
    change =
      percent <= 0
        ? { percent, label: `${Math.abs(percent)}% smaller`, className: 'batch-delta-smaller' }
        : { percent, label: `+${percent}% larger`, className: 'batch-delta-larger' };
  }

  return (
    <li className="batch-item">
      {url ? (
        <img src={url} alt="" className="batch-thumb" />
      ) : (
        <div className="batch-thumb batch-thumb-fallback" aria-hidden="true">
          📄
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

      <Button variant="secondary" onClick={() => downloadBlob(item.blob, item.name)}>
        Download
      </Button>
    </li>
  );
}

export function BatchResults({ items, onReset }: BatchResultsProps) {
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadAll() {
    setZipping(true);
    setError(null);
    try {
      const zip = await zipFiles(items.map(({ name, blob }) => ({ name, blob })));
      downloadBlob(zip, 'loconvert-images.zip');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ZIP file.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="batch-results">
      <ul className="batch-list">
        {items.map((item, index) => (
          <BatchRow key={`${item.name}-${index}`} item={item} />
        ))}
      </ul>

      {error && <div role="alert">{error}</div>}

      <div className="batch-actions">
        <Button variant="secondary" onClick={onReset}>
          Start over
        </Button>
        <Button variant="primary" onClick={downloadAll} disabled={zipping || items.length === 0}>
          {zipping ? 'Zipping…' : 'Download all (.zip)'}
        </Button>
      </div>
    </div>
  );
}
