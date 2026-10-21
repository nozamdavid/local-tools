import { Button } from '../../../components/Controls';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';

export interface DownloadResultProps {
  blob: Blob;
  filename: string;
  /** Short line shown above the stats, such as "3 pages became 3 slides". */
  summary?: string;
  onReset: () => void;
}

export function DownloadResult({ blob, filename, summary, onReset }: DownloadResultProps) {
  return (
    <div className="result-panel">
      {summary && <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)' }}>{summary}</p>}

      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">Output file</span>
          <span className="stat-value" style={{ fontSize: '0.95rem' }}>
            {filename}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Output size</span>
          <span className="stat-value">{formatBytes(blob.size)}</span>
        </div>
      </div>

      <div className="action-buttons">
        <Button variant="secondary" onClick={onReset}>
          Start over
        </Button>
        <Button variant="primary" onClick={() => downloadBlob(blob, filename)}>
          Download {filename}
        </Button>
      </div>
    </div>
  );
}
