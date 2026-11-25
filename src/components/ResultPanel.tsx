import React, { useEffect, useId, useRef, useState } from 'react';
import { formatBytes, formatNumber } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useObjectUrl } from '../lib/useObjectUrl';
import { decodeJxlToBlob, isJxlFile } from '../lib/jxl';
import { CircleCheck, Download, RotateCcw } from 'lucide-react';
import { Button } from './Controls';
import { useFocusFallback } from './useFocusFallback';
import { ContinueWith } from './ContinueWith';
import { useI18n } from '../lib/i18n';

export interface ResultPanelProps {
  blob: Blob;
  filename: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  originalSize?: number;
  beforePreview?: React.ReactNode;
  children?: React.ReactNode;
  onReset: () => void;
}

export function ResultPanel({ blob, filename, kind, originalSize, beforePreview, children, onReset }: ResultPanelProps) {
  const { t } = useI18n();
  const url = useObjectUrl(blob);
  const [textContent, setTextContent] = useState<string>('');
  const [jxlPreviewUrl, setJxlPreviewUrl] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusFallback(panelRef);
  const titleId = useId();
  const subId = useId();

  // The job button that started the work has just left the page; move focus to the result so it is announced.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (kind === 'text') {
      blob
        .text()
        .then(setTextContent)
        .catch(() => setTextContent(t('(Failed to read text)')));
    }
  }, [blob, kind, t]);

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
    <div className="result-panel" ref={panelRef} tabIndex={-1} role="region" aria-labelledby={titleId} aria-describedby={subId}>
      <div className="result-header">
        <span className="result-header-icon" aria-hidden="true">
          <CircleCheck />
        </span>
        <div>
          <div className="result-header-title" id={titleId}>
            {t('Done')}
          </div>
          <div className="result-header-sub" id={subId}>
            {t('Review your output before downloading.')}
          </div>
        </div>
      </div>

      <div className="preview-grid">
        {beforePreview && (
          <div className="preview-box">
            <div className="preview-box-title">{t('Original')}</div>
            {beforePreview}
          </div>
        )}
        <div className="preview-box">
          <div className="preview-box-title">{beforePreview ? t('Result') : t('Preview')}</div>
          {renderAfterMedia()}
        </div>
      </div>

      {children}

      <div className="stats-row">
        <div className="stat-item" style={{ flex: '1 1 220px' }}>
          <span className="stat-label">{t('Output file')}</span>
          <span className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
            {filename}
          </span>
        </div>

        <div className="stat-item">
          <span className="stat-label">{t('Size')}</span>
          <span className="stat-value">
            {originalSize !== undefined && originalSize > 0 && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>{formatBytes(originalSize)} → </span>
            )}
            {formatBytes(blob.size)}
          </span>
        </div>

        {changePercent !== null && (
          <div className="stat-item">
            <span className="stat-label">{t('Change')}</span>
            <span
              className={`badge ${changePercent <= 0 ? 'badge-success' : 'badge-warning'}`}
              style={{ alignSelf: 'flex-start', marginTop: 'var(--space-1)' }}
            >
              {changePercent <= 0
                ? t('{percent}% smaller', { percent: formatNumber(Math.abs(changePercent)) })
                : t('{percent}% larger', { percent: formatNumber(changePercent) })}
            </span>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <ContinueWith results={[{ name: filename, blob }]} />
        <Button variant="ghost" icon={<RotateCcw />} onClick={onReset}>
          {t('Start over')}
        </Button>
        <Button variant="primary" size="lg" icon={<Download />} onClick={() => downloadBlob(blob, filename)}>
          {t('Download')}
        </Button>
      </div>
    </div>
  );
}
