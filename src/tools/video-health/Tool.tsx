import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { ProgressBar } from '../../components/ProgressBar';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { diagnoseVideoFile, type VideoHealthReport } from '../_file-utility/video';
import styles from './Tool.module.css';

type Translator = (sourceEnglish: string, params?: Record<string, string | number>) => string;

function translateHealthMessage(message: string, t: Translator): string {
  const patterns: Array<[RegExp, string, (match: RegExpMatchArray) => Record<string, string | number>]> = [
    [
      /^Incomplete atom header at byte offset (.+): expected (.+) bytes, only (.+) available\.$/,
      'Incomplete atom header at byte offset {offset}: expected {expected} bytes, only {available} available.',
      (match) => ({ offset: match[1], expected: match[2], available: match[3] }),
    ],
    [
      /^Truncated 64-bit atom header for '(.+)' at offset (.+)\.$/,
      "Truncated 64-bit atom header for '{type}' at offset {offset}.",
      (match) => ({ type: match[1], offset: match[2] }),
    ],
    [
      /^Invalid 64-bit size \((.+) bytes\) for box '(.+)' at offset (.+)\.$/,
      "Invalid 64-bit size ({size} bytes) for box '{type}' at offset {offset}.",
      (match) => ({ size: match[1], type: match[2], offset: match[3] }),
    ],
    [
      /^Invalid 32-bit atom size \((.+) bytes\) for box '(.+)' at offset (.+)\. Minimum is (.+) bytes\.$/,
      "Invalid 32-bit atom size ({size} bytes) for box '{type}' at offset {offset}. Minimum is {minimum} bytes.",
      (match) => ({ size: match[1], type: match[2], offset: match[3], minimum: match[4] }),
    ],
    [
      /^Box '(.+)' at offset (.+) declares size (.+) bytes \(extending to (.+)\), which exceeds total file size \((.+) bytes\)\. File is truncated!$/,
      "Box '{type}' at offset {offset} declares size {size} bytes (extending to {end}), which exceeds total file size ({fileSize} bytes). File is truncated!",
      (match) => ({ type: match[1], offset: match[2], size: match[3], end: match[4], fileSize: match[5] }),
    ],
    [
      /^File truncated inside or immediately after EBML header \(size (.+) bytes <= header end (.+)\)\.$/,
      'File truncated inside or immediately after EBML header (size {fileSize} bytes <= header end {headerEnd}).',
      (match) => ({ fileSize: match[1], headerEnd: match[2] }),
    ],
    [/^Unexpected end of file at offset (.+)\.$/, 'Unexpected end of file at offset {offset}.', (match) => ({ offset: match[1] })],
    [
      /^Truncated EBML Void element size at offset (.+)\.$/,
      'Truncated EBML Void element size at offset {offset}.',
      (match) => ({ offset: match[1] }),
    ],
    [
      /^EBML Void element at offset (.+) declares size (.+) bytes extending past file end \((.+) bytes\)\.$/,
      'EBML Void element at offset {offset} declares size {size} bytes extending past file end ({fileSize} bytes).',
      (match) => ({ offset: match[1], size: match[2], fileSize: match[3] }),
    ],
    [
      /^Truncated EBML CRC-32 element size at offset (.+)\.$/,
      'Truncated EBML CRC-32 element size at offset {offset}.',
      (match) => ({ offset: match[1] }),
    ],
    [
      /^EBML CRC-32 element at offset (.+) declares size (.+) bytes extending past file end \((.+) bytes\)\.$/,
      'EBML CRC-32 element at offset {offset} declares size {size} bytes extending past file end ({fileSize} bytes).',
      (match) => ({ offset: match[1], size: match[2], fileSize: match[3] }),
    ],
    [
      /^Incomplete Segment ID at byte offset (.+): expected (.+) bytes \(0x18538067\), only (.+) available\.$/,
      'Incomplete Segment ID at byte offset {offset}: expected {expected} bytes (0x18538067), only {available} available.',
      (match) => ({ offset: match[1], expected: match[2], available: match[3] }),
    ],
    [
      /^Missing or truncated Segment size field at offset (.+)\.$/,
      'Missing or truncated Segment size field at offset {offset}.',
      (match) => ({ offset: match[1] }),
    ],
    [
      /^Declared EBML Segment end \((.+) bytes\) exceeds total file size \((.+) bytes\)\. File is truncated by (.+) bytes!$/,
      'Declared EBML Segment end ({end} bytes) exceeds total file size ({fileSize} bytes). File is truncated by {missing} bytes!',
      (match) => ({ end: match[1], fileSize: match[2], missing: match[3] }),
    ],
    [
      /^Expected Segment ID 0x18538067 at offset (.+), found (.+)\.$/,
      'Expected Segment ID 0x18538067 at offset {offset}, found {bytes}.',
      (match) => ({ offset: match[1], bytes: match[2] }),
    ],
    [
      /^File truncated: Actual file size \((.+) bytes\) is smaller than declared RIFF container size \((.+) bytes\)\. Missing (.+) bytes\.$/,
      'File truncated: Actual file size ({actual} bytes) is smaller than declared RIFF container size ({declared} bytes). Missing {missing} bytes.',
      (match) => ({ actual: match[1], declared: match[2], missing: match[3] }),
    ],
    [
      /^File contains trailing bytes: Actual file size \((.+) bytes\) exceeds declared RIFF container size \((.+) bytes\) by (.+) bytes\.$/,
      'File contains trailing bytes: Actual file size ({actual} bytes) exceeds declared RIFF container size ({declared} bytes) by {extra} bytes.',
      (match) => ({ actual: match[1], declared: match[2], extra: match[3] }),
    ],
  ];

  for (const [pattern, source, params] of patterns) {
    const match = message.match(pattern);
    if (match) return t(source, params(match));
  }
  return t(message);
}

export default function VideoHealthTool() {
  const { t } = useI18n();
  const meta = getToolMeta('video-health');
  const title = meta.title !== 'video-health' ? meta.title : t('Video Health Inspector');
  const description =
    meta.description ||
    t('Inspect MP4/MOV, MKV/WebM, and AVI video containers for truncation, missing headers, and corruption without uploading.');

  const [loading, setLoading] = useState<boolean>(false);
  const [report, setReport] = useState<VideoHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const result = await diagnoseVideoFile(file);
      setReport(result);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to inspect video file');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!report) return;
    const blob = new Blob([report.diagnosticJson], { type: 'application/json' });
    downloadBlob(blob, `${report.fileName}-health-report.json`);
  };

  const handleDownloadTxt = () => {
    if (!report) return;
    const blob = new Blob([report.diagnosticTxt], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${report.fileName}-health-report.txt`);
  };

  const getStatusBadge = () => {
    if (!report) return null;
    switch (report.status) {
      case 'healthy':
        return <span className={styles.badgeHealthy}>✓ {t('Container Healthy')}</span>;
      case 'corrupted':
        return <span className={styles.badgeCorrupted}>✗ {t('Corrupted / Truncated')}</span>;
      case 'codec-unsupported':
        return <span className={styles.badgeCodec}>⚠️ {t('Codec Unsupported in Browser')}</span>;
      case 'unknown-format':
      default:
        return <span className={styles.badgeUnknown}>? {t('Unknown Format')}</span>;
    }
  };

  const getStatusCardClass = () => {
    if (!report) return styles.statusCard;
    switch (report.status) {
      case 'healthy':
        return `${styles.statusCard} ${styles.statusHealthy}`;
      case 'corrupted':
        return `${styles.statusCard} ${styles.statusCorrupted}`;
      case 'codec-unsupported':
        return `${styles.statusCard} ${styles.statusCodecUnsupported}`;
      case 'unknown-format':
      default:
        return `${styles.statusCard} ${styles.statusUnknown}`;
    }
  };

  return (
    <ToolPage title={title} description={description} currentId="video-health">
      <div className={styles.container}>
        <FileDrop
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
          multiple={false}
          label={t('Select or drop a video file to inspect')}
          hint={t('Inspects container box/atom boundaries, headers, and declared sizes locally. No data leaves your machine.')}
          onFiles={handleFiles}
        />

        {loading && (
          <div>
            <p style={{ fontSize: '0.9rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
              {t('Inspecting container structures and testing playability...')}
            </p>
            <ProgressBar value={0.5} />
          </div>
        )}

        {error && (
          <div className={styles.issuesList}>
            <div className={styles.issueItem}>
              <span>❌</span>
              <span>{translateHealthMessage(error, t)}</span>
            </div>
          </div>
        )}

        {report && (
          <div className={getStatusCardClass()}>
            <div className={styles.statusTitleRow}>
              <div className={styles.statusHeader}>
                <span className={styles.statusIcon}>
                  {report.status === 'healthy' && '🟢'}
                  {report.status === 'corrupted' && '🔴'}
                  {report.status === 'codec-unsupported' && '🟡'}
                  {report.status === 'unknown-format' && '⚪'}
                </span>
                <div>
                  <h2 className={styles.statusTitle}>{translateHealthMessage(report.statusMessage, t)}</h2>
                  <p className={styles.statusSubtitle}>{report.fileName}</p>
                </div>
              </div>
              <div>{getStatusBadge()}</div>
            </div>

            <div className={styles.gridStats}>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>{t('Container Type')}</div>
                <div className={styles.statVal}>{report.containerType.toUpperCase()}</div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>{t('File Size')}</div>
                <div className={styles.statVal}>{formatBytes(report.fileSize)}</div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>{t('Browser Playable')}</div>
                <div className={styles.statVal}>
                  {report.playableInBrowser ? (
                    <span style={{ color: '#34d399' }}>{t('Yes')}</span>
                  ) : (
                    <span style={{ color: '#f87171' }}>{t('No')}</span>
                  )}
                </div>
              </div>
              {report.duration && (
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>{t('Duration')}</div>
                  <div className={styles.statVal}>{report.duration.toFixed(2)}s</div>
                </div>
              )}
              {report.videoWidth && report.videoHeight && (
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>{t('Resolution')}</div>
                  <div className={styles.statVal}>
                    {report.videoWidth} x {report.videoHeight}
                  </div>
                </div>
              )}
            </div>

            {/* Issues Found */}
            {report.issues.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f87171', margin: '0 0 0.5rem 0' }}>
                  {t('Critical Container Issues ({count})', { count: report.issues.length })}
                </h3>
                <div className={styles.issuesList}>
                  {report.issues.map((issue, idx) => (
                    <div key={idx} className={styles.issueItem}>
                      <span>⚠️</span>
                      <span>{translateHealthMessage(issue, t)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fbbf24', margin: '0 0 0.5rem 0' }}>
                  {t('Warnings ({count})', { count: report.warnings.length })}
                </h3>
                <div className={styles.issuesList}>
                  {report.warnings.map((warn, idx) => (
                    <div key={idx} className={styles.warningItem}>
                      <span>ℹ️</span>
                      <span>{translateHealthMessage(warn, t)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Atom / Box Table */}
            {report.atoms.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
                  {t('Scanned Atoms / Elements ({count})', { count: report.atoms.length })}
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.atomTable}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('Type / Identifier')}</th>
                        <th>{t('Byte Offset')}</th>
                        <th>{t('Size (Bytes)')}</th>
                        <th>{t('Header Size')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.atoms.slice(0, 50).map((atom, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>
                            <strong>{atom.type}</strong>
                          </td>
                          <td>
                            0x{atom.offset.toString(16).padStart(8, '0')} ({atom.offset})
                          </td>
                          <td>{atom.size.toLocaleString()}</td>
                          <td>{atom.headerSize}B</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.atoms.length > 50 && (
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.35rem' }}>
                    {t('Showing first 50 of {count} scanned container boxes. Full list included in diagnostic export.', {
                      count: report.atoms.length,
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className={styles.actionRow}>
              <Button variant="primary" onClick={handleDownloadJson}>
                {t('Download Diagnostic (JSON)')}
              </Button>
              <Button variant="secondary" onClick={handleDownloadTxt}>
                {t('Download Report (TXT)')}
              </Button>
              <Button variant="secondary" onClick={() => setReport(null)}>
                {t('Inspect Another Video')}
              </Button>
            </div>

            {/* Explicit Disclaimer */}
            <div className={styles.disclaimerBanner}>
              <strong>{t('Diagnostic Notice:')}</strong>{' '}
              {t(
                'This tool provides non-destructive structural analysis of video container boundaries and headers. It is diagnostic only; no claims or guarantees of file repair or security verification are made.',
              )}
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
