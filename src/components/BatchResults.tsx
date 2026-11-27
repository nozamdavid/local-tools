import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, formatNumber } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { zipFiles } from '../lib/zip';
import { extensionOf, mimeOf } from '../lib/toolInputs';
import { Download, File as FileIcon, FolderDown, RotateCcw } from 'lucide-react';
import { Button } from './Controls';
import { CopyImageButton } from './CopyImageButton';
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

const ARCHIVE_FILENAME = 'images.zip';

function BatchRow({ item }: { item: BatchResultItem }) {
  const { t } = useI18n();
  const { blob, name } = item;
  const image = useMemo(() => {
    const mime = mimeOf({ name, type: blob.type });
    if (!mime.startsWith('image/') || extensionOf(name) === 'zip') return undefined;
    return mime === blob.type ? blob : blob.slice(0, blob.size, mime);
  }, [blob, name]);
  const url = useObjectUrl(image);

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
      <div className="batch-file">
        {url ? (
          <img src={url} alt="" className="batch-thumb" />
        ) : (
          <div className="batch-thumb batch-thumb-fallback" aria-hidden="true">
            <FileIcon />
          </div>
        )}
        <div className="batch-info">
          <div className="batch-name" title={name}>
            {name}
          </div>
          <div className="batch-meta">
            {item.originalSize !== undefined && <>{formatBytes(item.originalSize)} → </>}
            {formatBytes(blob.size)}
            {change && (
              <>
                {' · '}
                <span className={change.className}>{change.label}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="batch-row-actions">
        {image && <CopyImageButton getImage={() => image} filename={name} size="sm" />}
        <Button
          variant="ghost"
          size="sm"
          icon={<Download />}
          aria-label={t('Download {file}', { file: name })}
          onClick={() => downloadBlob(blob, name)}
        >
          {t('Download')}
        </Button>
      </div>
    </li>
  );
}

export function BatchResults({ items, onReset }: BatchResultsProps) {
  const { t } = useI18n();
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const archiveRequest = useRef<AbortController | null>(null);
  useFocusFallback(panelRef);

  useLayoutEffect(() => () => archiveRequest.current?.abort(), []);

  // The button that started the batch has left the page; move focus here so the outcome is announced.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  async function downloadAll() {
    if (archiveRequest.current) return;
    const request = new AbortController();
    archiveRequest.current = request;
    setZipping(true);
    setError(null);
    try {
      const zip = await zipFiles(items);
      if (!request.signal.aborted) downloadBlob(zip, ARCHIVE_FILENAME);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : t('Could not create the ZIP file.'));
    } finally {
      archiveRequest.current = null;
      if (!request.signal.aborted) setZipping(false);
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
        <div className="batch-archive">
          <span className="batch-meta">{ARCHIVE_FILENAME}</span>
          <Button
            variant="primary"
            size="lg"
            icon={<FolderDown />}
            aria-label={t('Download all {count} (.zip)', { count: items.length })}
            loading={zipping}
            onClick={downloadAll}
            disabled={items.length === 0}
          >
            {t('Download')}
          </Button>
        </div>
      </div>
    </div>
  );
}
