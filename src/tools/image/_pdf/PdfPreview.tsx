import { useState, useEffect } from 'react';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { Button } from '../../../components/Controls';
import { loadPdfDocument, renderPdfThumbnail } from './pdfRenderer';

export interface PdfPreviewProps {
  blob: Blob;
  filename: string;
  originalSize?: number;
  pageCount?: number;
  onReset: () => void;
}

export function PdfPreview({
  blob,
  filename,
  originalSize,
  pageCount,
  onReset,
}: PdfPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadPdfDocument(blob)
      .then(async (doc) => {
        const dataUrl = await renderPdfThumbnail(doc, 1, 600);
        if (active) setPreviewUrl(dataUrl);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [blob]);

  let changePercent: number | null = null;
  if (originalSize && originalSize > 0) {
    changePercent = Math.round(((blob.size - originalSize) / originalSize) * 100);
  }

  return (
    <div className="result-panel">
      <div className="preview-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="preview-box">
          <div className="preview-box-title">PDF Preview (Page 1)</div>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="PDF Page 1 Preview"
              className="preview-media"
              style={{
                maxHeight: '420px',
                objectFit: 'contain',
                backgroundColor: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                display: 'block',
                margin: '0 auto',
              }}
            />
          ) : (
            <div style={{ padding: '3rem', color: 'var(--text-muted)' }}>
              Rendering PDF preview…
            </div>
          )}
        </div>
      </div>

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

        {pageCount !== undefined && (
          <div className="stat-item">
            <span className="stat-label">Pages</span>
            <span className="stat-value">{pageCount}</span>
          </div>
        )}

        {changePercent !== null && (
          <div className="stat-item">
            <span className="stat-label">Difference</span>
            <span
              className={`badge ${changePercent <= 0 ? 'badge-success' : ''}`}
              style={{ alignSelf: 'flex-start', marginTop: '0.2rem' }}
            >
              {changePercent <= 0
                ? `${Math.abs(changePercent)}% reduction`
                : `+${changePercent}% larger`}
            </span>
          </div>
        )}
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
