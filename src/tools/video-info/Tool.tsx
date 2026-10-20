import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getFFmpeg, mimeFromName } from '../../lib/ffmpeg';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { downloadBlob } from '../../lib/download';
import { parseFFmpegLog, type ParsedVideoInfo } from './parse';
import styles from './Tool.module.css';

interface FullReport {
  file: {
    name: string;
    size: number;
    formattedSize: string;
    mimeType: string;
    lastModified: string;
  };
  videoMeta: VideoMeta | null;
  ffmpegInfo: ParsedVideoInfo;
  rawLog: string;
}

export default function VideoInfoTool() {
  const meta = getToolMeta('video-info');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FullReport | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setError(null);
    setReport(null);
    setLoading(true);

    try {
      // 1. Extract HTML Video Meta (safe fallback if it fails)
      let vMeta: VideoMeta | null = null;
      try {
        vMeta = await getVideoMeta(selected);
      } catch {
        // Audio or unsupported container for HTML5 video element
      }

      // 2. Run FFmpeg directly to collect log output
      const ffmpeg = await getFFmpeg();
      const logLines: string[] = [];
      const handleLog = ({ message }: { message: string }) => {
        logLines.push(message);
      };

      ffmpeg.on('log', handleLog);

      const dotIdx = selected.name.lastIndexOf('.');
      const ext = dotIdx >= 0 ? selected.name.slice(dotIdx) : '.bin';
      const inputName = `probe_${Date.now()}${ext}`;

      try {
        const ab = await selected.arrayBuffer();
        await ffmpeg.writeFile(inputName, new Uint8Array(ab));
        await ffmpeg.exec(['-hide_banner', '-i', inputName]);
      } catch {
        // Expected: ffmpeg exits with code 1 when no output file is provided
      } finally {
        try {
          await ffmpeg.deleteFile(inputName);
        } catch {
          // Ignore cleanup error
        }
        ffmpeg.off('log', handleLog);
      }

      const rawLog = logLines.join('\n');
      const parsed = parseFFmpegLog(rawLog);

      const fullReport: FullReport = {
        file: {
          name: selected.name,
          size: selected.size,
          formattedSize: formatBytes(selected.size),
          mimeType: selected.type || mimeFromName(selected.name),
          lastModified: new Date(selected.lastModified).toLocaleString(),
        },
        videoMeta: vMeta,
        ffmpegInfo: parsed,
        rawLog,
      };

      setReport(fullReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect file');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setReport(null);
    setError(null);
  };

  const handleCopyText = async () => {
    if (!report) return;

    const lines: string[] = [];
    lines.push(`=== File Information ===`);
    lines.push(`File Name: ${report.file.name}`);
    lines.push(`File Size: ${report.file.formattedSize} (${report.file.size} bytes)`);
    lines.push(`MIME Type: ${report.file.mimeType}`);
    lines.push(`Last Modified: ${report.file.lastModified}`);
    lines.push(`Container / Format: ${report.ffmpegInfo.container || 'Unknown'}`);
    lines.push(`Duration: ${report.ffmpegInfo.duration || 'N/A'}`);
    lines.push(`Overall Bitrate: ${report.ffmpegInfo.bitrate || 'N/A'}`);
    if (report.ffmpegInfo.creationTime) {
      lines.push(`Creation Time: ${report.ffmpegInfo.creationTime}`);
    }
    if (report.videoMeta) {
      lines.push(`HTML5 Video Resolution: ${report.videoMeta.width}x${report.videoMeta.height}`);
      lines.push(`HTML5 Video Duration: ${formatDuration(report.videoMeta.duration)}`);
    }

    if (Object.keys(report.ffmpegInfo.metadata).length > 0) {
      lines.push(`\n=== Container Metadata ===`);
      for (const [k, v] of Object.entries(report.ffmpegInfo.metadata)) {
        lines.push(`${k}: ${v}`);
      }
    }

    report.ffmpegInfo.streams.forEach((stream) => {
      lines.push(`\n=== Stream #${stream.index} (${stream.type.toUpperCase()}) ===`);
      lines.push(`Codec: ${stream.codecProfile}`);
      if (stream.resolution) lines.push(`Resolution: ${stream.resolution}`);
      if (stream.sarDar) lines.push(`SAR/DAR: ${stream.sarDar}`);
      if (stream.pixelFormat) lines.push(`Pixel Format: ${stream.pixelFormat}`);
      if (stream.fps) lines.push(`Frame Rate: ${stream.fps}`);
      if (stream.bitrate) lines.push(`Bitrate: ${stream.bitrate}`);
      if (stream.rotation) lines.push(`Rotation: ${stream.rotation}`);
      if (stream.audioSampleRate) lines.push(`Sample Rate: ${stream.audioSampleRate}`);
      if (stream.channelsLayout) lines.push(`Channels/Layout: ${stream.channelsLayout}`);
      if (stream.language) lines.push(`Language: ${stream.language}`);
      if (Object.keys(stream.metadata).length > 0) {
        lines.push(`Metadata:`);
        for (const [k, v] of Object.entries(stream.metadata)) {
          lines.push(`  ${k}: ${v}`);
        }
      }
    });

    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJSON = () => {
    if (!report || !file) return;
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, replaceExt(file.name, '.info.json'));
  };

  const videoStreams = report?.ffmpegInfo.streams.filter((s) => s.type === 'video') || [];
  const audioStreams = report?.ffmpegInfo.streams.filter((s) => s.type === 'audio') || [];
  const otherStreams =
    report?.ffmpegInfo.streams.filter((s) => s.type !== 'video' && s.type !== 'audio') || [];

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="video-info">
      {!file && (
        <FileDrop
          accept="video/*,audio/*"
          label="Choose a video or audio file to inspect"
          hint="Inspect codecs, bitrates, audio tracks, and metadata."
          onFiles={handleFiles}
        />
      )}

      {loading && (
        <div className={styles.loadingBox}>
          <div className={styles.loadingSpinner} />
          <p>Analyzing media stream headers with FFmpeg...</p>
        </div>
      )}

      {error && (
        <div>
          <div className="error-banner">{error}</div>
          <div className="action-buttons">
            <Button variant="secondary" onClick={handleReset}>
              Try another file
            </Button>
          </div>
        </div>
      )}

      {report && !loading && (
        <div className={styles.container}>
          {/* Action bar */}
          <div className={styles.actionBar}>
            <div className={styles.actionBarLeft}>
              <Button variant="primary" onClick={handleCopyText}>
                {copied ? '✓ Copied to clipboard!' : 'Copy as text'}
              </Button>
              <Button variant="secondary" onClick={handleDownloadJSON}>
                Download JSON
              </Button>
            </div>
            <Button variant="secondary" onClick={handleReset}>
              Analyze another file
            </Button>
          </div>

          {/* Group: General */}
          <div className={styles.tableGroup}>
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>General Information</h3>
              <span className={`${styles.badge} ${styles.badgeOther}`}>Overview</span>
            </div>
            <div className={styles.tableWrapper}>
              <table className={styles.infoTable}>
                <tbody>
                  <tr>
                    <td className={styles.propKey}>File Name</td>
                    <td className={styles.propVal}>{report.file.name}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>File Size</td>
                    <td className={styles.propVal}>
                      {report.file.formattedSize} ({report.file.size.toLocaleString()} bytes)
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>MIME Type</td>
                    <td className={styles.propVal}>{report.file.mimeType}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>Last Modified</td>
                    <td className={styles.propVal}>{report.file.lastModified}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>Container / Format</td>
                    <td className={styles.propVal}>
                      {report.ffmpegInfo.container || 'Unknown'}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>Duration (FFmpeg)</td>
                    <td className={styles.propVal}>
                      {report.ffmpegInfo.duration || 'N/A'}
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>Overall Bitrate</td>
                    <td className={styles.propVal}>
                      {report.ffmpegInfo.bitrate || 'N/A'}
                    </td>
                  </tr>
                  {report.ffmpegInfo.creationTime && (
                    <tr>
                      <td className={styles.propKey}>Creation Time</td>
                      <td className={styles.propVal}>{report.ffmpegInfo.creationTime}</td>
                    </tr>
                  )}
                  {report.videoMeta && (
                    <>
                      <tr>
                        <td className={styles.propKey}>HTML5 Video Dimensions</td>
                        <td className={styles.propVal}>
                          {report.videoMeta.width}x{report.videoMeta.height}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.propKey}>HTML5 Video Duration</td>
                        <td className={styles.propVal}>
                          {formatDuration(report.videoMeta.duration)} ({report.videoMeta.duration.toFixed(2)}s)
                        </td>
                      </tr>
                    </>
                  )}
                  {Object.entries(report.ffmpegInfo.metadata).map(([key, val]) => {
                    if (key.toLowerCase() === 'creation_time') return null;
                    return (
                      <tr key={key}>
                        <td className={styles.propKey}>Tag: {key}</td>
                        <td className={styles.propVal}>{val}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Group: Video Streams */}
          {videoStreams.map((stream) => (
            <div key={`video-${stream.index}`} className={styles.tableGroup}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>Video #{stream.index}</h3>
                <span className={`${styles.badge} ${styles.badgeVideo}`}>Video Stream</span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>Stream Index</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Codec + Profile</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Resolution</td>
                      <td className={styles.propVal}>{stream.resolution || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>SAR / DAR</td>
                      <td className={styles.propVal}>{stream.sarDar || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Pixel Format</td>
                      <td className={styles.propVal}>{stream.pixelFormat || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Frame Rate</td>
                      <td className={styles.propVal}>{stream.fps || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Bitrate</td>
                      <td className={styles.propVal}>{stream.bitrate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Rotation</td>
                      <td className={styles.propVal}>{stream.rotation || '0°'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Language</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`v-meta-${key}`}>
                        <td className={styles.propKey}>Tag: {key}</td>
                        <td className={styles.propVal}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Group: Audio Streams */}
          {audioStreams.map((stream) => (
            <div key={`audio-${stream.index}`} className={styles.tableGroup}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>Audio #{stream.index}</h3>
                <span className={`${styles.badge} ${styles.badgeAudio}`}>Audio Stream</span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>Stream Index</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Codec + Profile</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Sample Rate</td>
                      <td className={styles.propVal}>{stream.audioSampleRate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Channels / Layout</td>
                      <td className={styles.propVal}>{stream.channelsLayout || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Bitrate</td>
                      <td className={styles.propVal}>{stream.bitrate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Language</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`a-meta-${key}`}>
                        <td className={styles.propKey}>Tag: {key}</td>
                        <td className={styles.propVal}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Group: Subtitle / Data Streams */}
          {otherStreams.map((stream) => (
            <div key={`other-${stream.index}`} className={styles.tableGroup}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>
                  {stream.type.charAt(0).toUpperCase() + stream.type.slice(1)} #{stream.index}
                </h3>
                <span
                  className={`${styles.badge} ${
                    stream.type === 'subtitle' ? styles.badgeSubtitle : styles.badgeOther
                  }`}
                >
                  {stream.type}
                </span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>Stream Index</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Type</td>
                      <td className={styles.propVal}>{stream.type}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Codec / Format</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>Language</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`o-meta-${key}`}>
                        <td className={styles.propKey}>Tag: {key}</td>
                        <td className={styles.propVal}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Collapsible raw ffmpeg output */}
          <details className={styles.rawDetails}>
            <summary className={styles.rawSummary}>
              Raw ffmpeg output ({report.rawLog.split('\n').length} lines)
            </summary>
            <pre className={styles.rawPre}>{report.rawLog}</pre>
          </details>
        </div>
      )}
    </ToolPage>
  );
}
