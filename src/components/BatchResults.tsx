import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { zipFiles } from '../lib/zip';
import { Download, File as FileIcon, FolderDown, RotateCcw } from 'lucide-react';
import { Button } from './Controls';
import { useFocusFallback } from './useFocusFallback';

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
        aria-label={`Download ${item.name}`}
        onClick={() => downloadBlob(item.blob, item.name)}
      >
        Save
      </Button>
    </li>
  );
}

export function BatchResults({ items, onReset }: BatchResultsProps) {
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
      setError(err instanceof Error ? err.message : 'Could not create the ZIP file.');
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
      aria-label={`Results: ${items.length} ${items.length === 1 ? 'file' : 'files'} ready`}
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
        <Button variant="secondary" icon={<RotateCcw />} onClick={onReset}>
          Start over
        </Button>
        <Button variant="primary" size="lg" icon={<FolderDown />} loading={zipping} onClick={downloadAll} disabled={items.length === 0}>
          {zipping ? 'Zipping…' : `Download all ${items.length} (.zip)`}
        </Button>
      </div>
    </div>
  );
}
