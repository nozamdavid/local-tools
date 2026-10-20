import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { ProgressBar } from '../../components/ProgressBar';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { diagnoseVideoFile, type VideoHealthReport } from '../_file-utility/video';
import styles from './Tool.module.css';

export default function VideoHealthTool() {
  const meta = getToolMeta('video-health');
  const title = meta.title !== 'video-health' ? meta.title : 'Video Health Inspector';
  const description =
    meta.description ||
    'Inspect MP4/MOV, MKV/WebM, and AVI video containers for truncation, missing headers, and corruption without uploading.';

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
        return <span className={styles.badgeHealthy}>✓ Container Healthy</span>;
      case 'corrupted':
        return <span className={styles.badgeCorrupted}>✗ Corrupted / Truncated</span>;
      case 'codec-unsupported':
        return <span className={styles.badgeCodec}>⚠️ Codec Unsupported in Browser</span>;
      case 'unknown-format':
      default:
        return <span className={styles.badgeUnknown}>? Unknown Format</span>;
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
          label="Select or drop a video file to inspect"
          hint="Inspects container box/atom boundaries, headers, and declared sizes locally. No data leaves your machine."
          onFiles={handleFiles}
        />

        {loading && (
          <div>
            <p style={{ fontSize: '0.9rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
              Inspecting container structures and testing playability...
            </p>
            <ProgressBar value={0.5} />
          </div>
        )}

        {error && (
          <div className={styles.issuesList}>
            <div className={styles.issueItem}>
              <span>❌</span>
              <span>{error}</span>
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
                  <h2 className={styles.statusTitle}>{report.statusMessage}</h2>
                  <p className={styles.statusSubtitle}>{report.fileName}</p>
                </div>
              </div>
              <div>{getStatusBadge()}</div>
            </div>

            <div className={styles.gridStats}>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>Container Type</div>
                <div className={styles.statVal}>{report.containerType.toUpperCase()}</div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>File Size</div>
                <div className={styles.statVal}>{formatBytes(report.fileSize)}</div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>Browser Playable</div>
                <div className={styles.statVal}>
                  {report.playableInBrowser ? (
                    <span style={{ color: '#34d399' }}>Yes</span>
                  ) : (
                    <span style={{ color: '#f87171' }}>No</span>
                  )}
                </div>
              </div>
              {report.duration && (
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Duration</div>
                  <div className={styles.statVal}>{report.duration.toFixed(2)}s</div>
                </div>
              )}
              {report.videoWidth && report.videoHeight && (
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Resolution</div>
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
                  Critical Container Issues ({report.issues.length})
                </h3>
                <div className={styles.issuesList}>
                  {report.issues.map((issue, idx) => (
                    <div key={idx} className={styles.issueItem}>
                      <span>⚠️</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fbbf24', margin: '0 0 0.5rem 0' }}>
                  Warnings ({report.warnings.length})
                </h3>
                <div className={styles.issuesList}>
                  {report.warnings.map((warn, idx) => (
                    <div key={idx} className={styles.warningItem}>
                      <span>ℹ️</span>
                      <span>{warn}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Atom / Box Table */}
            {report.atoms.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
                  Scanned Atoms / Elements ({report.atoms.length})
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.atomTable}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Type / Identifier</th>
                        <th>Byte Offset</th>
                        <th>Size (Bytes)</th>
                        <th>Header Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.atoms.slice(0, 50).map((atom, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>
                            <strong>{atom.type}</strong>
                          </td>
                          <td>0x{atom.offset.toString(16).padStart(8, '0')} ({atom.offset})</td>
                          <td>{atom.size.toLocaleString()}</td>
                          <td>{atom.headerSize}B</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.atoms.length > 50 && (
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.35rem' }}>
                    Showing first 50 of {report.atoms.length} scanned container boxes. Full list included in diagnostic export.
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className={styles.actionRow}>
              <Button variant="primary" onClick={handleDownloadJson}>
                Download Diagnostic (JSON)
              </Button>
              <Button variant="secondary" onClick={handleDownloadTxt}>
                Download Report (TXT)
              </Button>
              <Button variant="secondary" onClick={() => setReport(null)}>
                Inspect Another Video
              </Button>
            </div>

            {/* Explicit Disclaimer */}
            <div className={styles.disclaimerBanner}>
              <strong>Diagnostic Notice:</strong> This tool provides non-destructive structural analysis of video container boundaries and headers. It is diagnostic only; no claims or guarantees of file repair or security verification are made.
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
