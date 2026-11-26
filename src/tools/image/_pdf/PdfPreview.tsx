import { useState, useEffect } from 'react';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { Button } from '../../../components/Controls';
import { ContinueWith } from '../../../components/ContinueWith';
import { loadPdfDocument, renderPdfThumbnail } from './pdfRenderer';
import { useI18n } from '../../../lib/i18n';

export interface PdfPreviewProps {
  blob: Blob;
  filename: string;
  originalSize?: number;
  pageCount?: number;
  onReset: () => void;
}

export function PdfPreview({ blob, filename, originalSize, pageCount, onReset }: PdfPreviewProps) {
  const { t } = useI18n();
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
          <div className="preview-box-title">{t('PDF Preview (Page 1)')}</div>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={t('PDF Page 1 Preview')}
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
            <div style={{ padding: '3rem', color: 'var(--text-muted)' }}>{t('Rendering PDF preview…')}</div>
          )}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">{t('Output file')}</span>
          <span className="stat-value" style={{ fontSize: '0.95rem' }}>
            {filename}
          </span>
        </div>

        <div className="stat-item">
          <span className="stat-label">{t('Output size')}</span>
          <span className="stat-value">{formatBytes(blob.size)}</span>
        </div>

        {pageCount !== undefined && (
          <div className="stat-item">
            <span className="stat-label">{t('Pages')}</span>
            <span className="stat-value">{pageCount}</span>
          </div>
        )}

        {changePercent !== null && (
          <div className="stat-item">
            <span className="stat-label">{t('Difference')}</span>
            <span className={`badge ${changePercent <= 0 ? 'badge-success' : ''}`} style={{ alignSelf: 'flex-start', marginTop: '0.2rem' }}>
              {changePercent <= 0
                ? t('{percent}% reduction', { percent: Math.abs(changePercent) })
                : t('+{percent}% larger', { percent: changePercent })}
            </span>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <ContinueWith results={[{ name: filename, blob }]} />
        <Button variant="secondary" onClick={onReset}>
          {t('Start over')}
        </Button>
        <Button variant="primary" onClick={() => downloadBlob(blob, filename)}>
          {t('Download')}
        </Button>
      </div>
    </div>
  );
}
