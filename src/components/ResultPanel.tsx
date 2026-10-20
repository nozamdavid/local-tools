import React, { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { decodeJxlToBlob, isJxlFile } from '../lib/jxl';
import { CircleCheck, Download, RotateCcw } from 'lucide-react';
import { Button } from './Controls';

export interface ResultPanelProps {
  blob: Blob;
  filename: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  originalSize?: number;
  beforePreview?: React.ReactNode;
  children?: React.ReactNode;
  onReset: () => void;
}

export function ResultPanel({
  blob,
  filename,
  kind,
  originalSize,
  beforePreview,
  children,
  onReset,
}: ResultPanelProps) {
  const url = useObjectUrl(blob);
  const [textContent, setTextContent] = useState<string>('');
  const [jxlPreviewUrl, setJxlPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'text') {
      blob.text().then(setTextContent).catch(() => setTextContent('(Failed to read text)'));
    }
  }, [blob, kind]);

  useEffect(() => {
    let cancelled = false;
    let localUrl: string | null = null;

    if (kind === 'image') {
      const checkJxl = async () => {
        if (blob.type === 'image/jxl' || filename.toLowerCase().endsWith('.jxl') || (await isJxlFile(blob))) {
          try {
            const pngBlob = await decodeJxlToBlob(await blob.arrayBuffer());
            if (!cancelled) {
              localUrl = URL.createObjectURL(pngBlob);
              setJxlPreviewUrl(localUrl);
            }
          } catch {
            // Keep fallback
          }
        }
      };
      checkJxl();
    }

    return () => {
      cancelled = true;
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [blob, filename, kind]);

  let changePercent: number | null = null;
  if (originalSize && originalSize > 0) {
    changePercent = Math.round(((blob.size - originalSize) / originalSize) * 100);
  }

  const renderAfterMedia = () => {
    if (!url && kind !== 'text') return null;

    switch (kind) {
      case 'video':
        return <video controls src={url} className="preview-media" playsInline />;
      case 'audio':
        return <audio controls src={url} style={{ width: '100%', marginTop: 'auto', marginBottom: 'auto' }} />;
      case 'image':
        return <img src={jxlPreviewUrl || url} alt={filename} className="preview-media" />;
      case 'text':
        return <pre className="preview-text">{textContent}</pre>;
    }
  };

  return (
    <div className="result-panel">
      <div className="result-header">
        <span className="result-header-icon" aria-hidden="true">
          <CircleCheck />
        </span>
        <div>
          <div className="result-header-title">Done</div>
          <div className="result-header-sub">Processed on this device. Review it, then download.</div>
        </div>
      </div>

      <div className="preview-grid">
        {beforePreview && (
          <div className="preview-box">
            <div className="preview-box-title">Original</div>
            {beforePreview}
          </div>
        )}
        <div className="preview-box">
          <div className="preview-box-title">{beforePreview ? 'Result' : 'Preview'}</div>
          {renderAfterMedia()}
        </div>
      </div>

      {children}

      <div className="stats-row">
        <div className="stat-item" style={{ flex: '1 1 220px' }}>
          <span className="stat-label">Output file</span>
          <span className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
            {filename}
          </span>
        </div>

        <div className="stat-item">
          <span className="stat-label">Size</span>
          <span className="stat-value">
            {originalSize !== undefined && originalSize > 0 && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>{formatBytes(originalSize)} → </span>
            )}
            {formatBytes(blob.size)}
          </span>
        </div>

        {changePercent !== null && (
          <div className="stat-item">
            <span className="stat-label">Change</span>
            <span
              className={`badge ${changePercent <= 0 ? 'badge-success' : 'badge-warning'}`}
              style={{ alignSelf: 'flex-start', marginTop: 'var(--space-1)' }}
            >
              {changePercent <= 0 ? `${Math.abs(changePercent)}% smaller` : `${changePercent}% larger`}
            </span>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <Button variant="secondary" icon={<RotateCcw />} onClick={onReset}>
          Start over
        </Button>
        <Button variant="primary" size="lg" icon={<Download />} onClick={() => downloadBlob(blob, filename)}>
          Download
        </Button>
      </div>
    </div>
  );
}
