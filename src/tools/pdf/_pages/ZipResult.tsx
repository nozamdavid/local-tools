import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { Button } from '../../../components/Controls';

export interface ZipResultProps {
  zip: Blob;
  zipName: string;
  items: { name: string; blob: Blob }[];
  onReset: () => void;
}

/** Lists the files inside a freshly built ZIP and offers each file or the whole archive for download. */
export function ZipResult({ zip, zipName, items, onReset }: ZipResultProps) {
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
            <Button variant="secondary" onClick={() => downloadBlob(item.blob, item.name)}>
              Download
            </Button>
          </li>
        ))}
      </ul>

      <div className="batch-actions">
        <Button variant="secondary" onClick={onReset}>
          Start over
        </Button>
        <Button variant="primary" onClick={() => downloadBlob(zip, zipName)}>
          Download {zipName}
        </Button>
      </div>
    </div>
  );
}
