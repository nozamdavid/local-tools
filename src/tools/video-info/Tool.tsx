import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { mimeFromName, runFFmpeg } from '../../lib/ffmpeg';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { probeMedia, type MediaSummary } from '../../lib/mediabunny';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { downloadBlob } from '../../lib/download';
import { parseFFmpegLog, type ParsedVideoInfo } from './parse';
import { useI18n } from '../../lib/i18n';
import { copyText } from '../../lib/clipboard';
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
  inspectionEngine: 'Mediabunny' | 'FFmpeg';
}

function bitrateLabel(value: number | null): string | undefined {
  return value && value > 0 ? `${(value / 1000).toFixed(1)} kb/s` : undefined;
}

function parsedMediaSummary(summary: MediaSummary): ParsedVideoInfo {
  const creationTime = Object.entries(summary.metadata).find(([key]) => key.toLowerCase() === 'creation_time')?.[1];
  return {
    container: summary.format,
    duration: summary.duration === null ? '' : formatDuration(summary.duration),
    bitrate: '',
    creationTime,
    metadata: summary.metadata,
    streams: summary.tracks.map((track) => ({
      index: track.index,
      type: track.type,
      codecProfile: track.codec || 'Unknown',
      resolution: track.width && track.height ? `${Math.round(track.width)}x${Math.round(track.height)}` : undefined,
      sarDar: track.pixelAspectRatio ? `SAR ${track.pixelAspectRatio}` : undefined,
      rotation: track.rotation ? `${track.rotation}°` : '0°',
      audioSampleRate: track.sampleRate ? `${track.sampleRate} Hz` : undefined,
      channelsLayout: track.channels ? `${track.channels} channels` : undefined,
      bitrate: bitrateLabel(track.bitrate),
      language: track.language === 'und' ? undefined : track.language,
      metadata: {
        ...(track.name ? { name: track.name } : {}),
        ...(track.primary ? { primary: 'true' } : {}),
      },
      raw: [
        track.type,
        track.codec ?? 'unknown',
        track.width && track.height ? `${track.width}x${track.height}` : '',
        track.sampleRate ? `${track.sampleRate} Hz` : '',
      ]
        .filter(Boolean)
        .join(', '),
    })),
  };
}

function formatMediaSummary(summary: MediaSummary): string {
  const lines = [
    'Mediabunny metadata report',
    `Container: ${summary.format}`,
    `MIME type: ${summary.mimeType}`,
    `Duration: ${summary.duration === null ? 'Unknown' : `${summary.duration.toFixed(3)} s`}`,
    `Tracks: ${summary.tracks.length}`,
  ];
  for (const track of summary.tracks) {
    const details = [track.codec ?? 'unknown'];
    if (track.width && track.height) details.push(`${Math.round(track.width)}x${Math.round(track.height)}`);
    if (track.sampleRate) details.push(`${track.sampleRate} Hz`);
    if (track.channels) details.push(`${track.channels} channels`);
    if (track.bitrate) details.push(`${Math.round(track.bitrate / 1000)} kb/s`);
    if (track.language !== 'und') details.push(`language ${track.language}`);
    lines.push(`Track ${track.index} (${track.type}): ${details.join(', ')}`);
  }
  for (const [key, value] of Object.entries(summary.metadata)) lines.push(`Metadata ${key}: ${value}`);
  return lines.join('\n');
}

export default function VideoInfoTool() {
  const { t } = useI18n();
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
      const summary = await probeMedia(selected);
      let vMeta: VideoMeta | null = null;
      if (summary) {
        const primaryVideo =
          summary.tracks.find((track) => track.type === 'video' && track.primary) ?? summary.tracks.find((track) => track.type === 'video');
        if (primaryVideo?.width && primaryVideo.height) {
          vMeta = {
            duration: summary.duration ?? 0,
            width: Math.round(primaryVideo.width),
            height: Math.round(primaryVideo.height),
            hasAudio: summary.tracks.some((track) => track.type === 'audio'),
          };
        }
      } else {
        try {
          vMeta = await getVideoMeta(selected);
        } catch {
          // Audio or unsupported container for HTML5 video element
        }
      }

      let parsed: ParsedVideoInfo;
      let rawLog: string;
      let inspectionEngine: FullReport['inspectionEngine'];
      if (summary) {
        parsed = parsedMediaSummary(summary);
        rawLog = formatMediaSummary(summary);
        inspectionEngine = 'Mediabunny';
      } else {
        const logLines: string[] = [];
        const dotIdx = selected.name.lastIndexOf('.');
        const ext = dotIdx >= 0 ? selected.name.slice(dotIdx) : '.bin';
        const inputName = `probe_${Date.now()}${ext}`;

        try {
          await runFFmpeg({
            inputs: [{ name: inputName, data: selected }],
            args: ['-hide_banner', '-i', inputName],
            output: 'probe-output.tmp',
            onLog: (line) => logLines.push(line),
          });
        } catch {
          // FFmpeg exits with code 1 when no output file is provided.
        }

        rawLog = logLines.join('\n');
        parsed = parseFFmpegLog(rawLog);
        inspectionEngine = 'FFmpeg';
      }

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
        inspectionEngine,
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

    try {
      await copyText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      alert(t('Could not copy to clipboard.'));
    }
  };

  const handleDownloadJSON = () => {
    if (!report || !file) return;
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, replaceExt(file.name, '.info.json'));
  };

  const videoStreams = report?.ffmpegInfo.streams.filter((s) => s.type === 'video') || [];
  const audioStreams = report?.ffmpegInfo.streams.filter((s) => s.type === 'audio') || [];
  const otherStreams = report?.ffmpegInfo.streams.filter((s) => s.type !== 'video' && s.type !== 'audio') || [];

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="video-info">
      {!file && (
        <FileDrop
          accept="video/*,audio/*"
          label={t('Choose a video or audio file to inspect')}
          hint={t('Inspect codecs, bitrates, audio tracks, and metadata.')}
          onFiles={handleFiles}
        />
      )}

      {loading && (
        <div className={styles.loadingBox}>
          <div className={styles.loadingSpinner} />
          <p>{t('Analyzing media stream headers...')}</p>
        </div>
      )}

      {error && (
        <div>
          <div className="error-banner">{t(error)}</div>
          <div className="action-buttons">
            <Button variant="secondary" onClick={handleReset}>
              {t('Try another file')}
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
                {copied ? `✓ ${t('Copied to clipboard!')}` : t('Copy as text')}
              </Button>
              <Button variant="secondary" onClick={handleDownloadJSON}>
                {t('Download JSON')}
              </Button>
            </div>
            <Button variant="secondary" onClick={handleReset}>
              {t('Analyze another file')}
            </Button>
          </div>

          {/* Group: General */}
          <div className={styles.tableGroup}>
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>{t('General Information')}</h3>
              <span className={`${styles.badge} ${styles.badgeOther}`}>{t('Overview')}</span>
            </div>
            <div className={styles.tableWrapper}>
              <table className={styles.infoTable}>
                <tbody>
                  <tr>
                    <td className={styles.propKey}>{t('File Name')}</td>
                    <td className={styles.propVal}>{report.file.name}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('File Size')}</td>
                    <td className={styles.propVal}>
                      {report.file.formattedSize} ({report.file.size.toLocaleString()} bytes)
                    </td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('MIME Type')}</td>
                    <td className={styles.propVal}>{report.file.mimeType}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('Last Modified')}</td>
                    <td className={styles.propVal}>{report.file.lastModified}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('Container / Format')}</td>
                    <td className={styles.propVal}>{report.ffmpegInfo.container || 'Unknown'}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('Duration')}</td>
                    <td className={styles.propVal}>{report.ffmpegInfo.duration || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className={styles.propKey}>{t('Overall Bitrate')}</td>
                    <td className={styles.propVal}>{report.ffmpegInfo.bitrate || 'N/A'}</td>
                  </tr>
                  {report.ffmpegInfo.creationTime && (
                    <tr>
                      <td className={styles.propKey}>{t('Creation Time')}</td>
                      <td className={styles.propVal}>{report.ffmpegInfo.creationTime}</td>
                    </tr>
                  )}
                  {report.videoMeta && (
                    <>
                      <tr>
                        <td className={styles.propKey}>{t('HTML5 Video Dimensions')}</td>
                        <td className={styles.propVal}>
                          {report.videoMeta.width}x{report.videoMeta.height}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.propKey}>{t('HTML5 Video Duration')}</td>
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
                        <td className={styles.propKey}>
                          {t('Tag:')} {key}
                        </td>
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
                <h3 className={styles.groupTitle}>{t('Video #{number}', { number: stream.index })}</h3>
                <span className={`${styles.badge} ${styles.badgeVideo}`}>{t('Video Stream')}</span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>{t('Stream Index')}</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Codec + Profile')}</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Resolution')}</td>
                      <td className={styles.propVal}>{stream.resolution || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('SAR / DAR')}</td>
                      <td className={styles.propVal}>{stream.sarDar || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Pixel Format')}</td>
                      <td className={styles.propVal}>{stream.pixelFormat || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Frame Rate')}</td>
                      <td className={styles.propVal}>{stream.fps || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Bitrate')}</td>
                      <td className={styles.propVal}>{stream.bitrate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Rotation')}</td>
                      <td className={styles.propVal}>{stream.rotation || '0°'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Language')}</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`v-meta-${key}`}>
                        <td className={styles.propKey}>
                          {t('Tag:')} {key}
                        </td>
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
                <h3 className={styles.groupTitle}>{t('Audio #{number}', { number: stream.index })}</h3>
                <span className={`${styles.badge} ${styles.badgeAudio}`}>{t('Audio Stream')}</span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>{t('Stream Index')}</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Codec + Profile')}</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Sample Rate')}</td>
                      <td className={styles.propVal}>{stream.audioSampleRate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Channels / Layout')}</td>
                      <td className={styles.propVal}>{stream.channelsLayout || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Bitrate')}</td>
                      <td className={styles.propVal}>{stream.bitrate || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Language')}</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`a-meta-${key}`}>
                        <td className={styles.propKey}>
                          {t('Tag:')} {key}
                        </td>
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
                  {t('{type} #{number}', { type: t(stream.type.charAt(0).toUpperCase() + stream.type.slice(1)), number: stream.index })}
                </h3>
                <span className={`${styles.badge} ${stream.type === 'subtitle' ? styles.badgeSubtitle : styles.badgeOther}`}>
                  {t(stream.type)}
                </span>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td className={styles.propKey}>{t('Stream Index')}</td>
                      <td className={styles.propVal}>#{stream.index}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Type')}</td>
                      <td className={styles.propVal}>{stream.type}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Codec / Format')}</td>
                      <td className={styles.propVal}>{stream.codecProfile || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className={styles.propKey}>{t('Language')}</td>
                      <td className={styles.propVal}>{stream.language || 'N/A'}</td>
                    </tr>
                    {Object.entries(stream.metadata).map(([key, val]) => (
                      <tr key={`o-meta-${key}`}>
                        <td className={styles.propKey}>
                          {t('Tag:')} {key}
                        </td>
                        <td className={styles.propVal}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* The raw section reflects the inspector used above. */}
          <details className={styles.rawDetails}>
            <summary className={styles.rawSummary}>
              {report.inspectionEngine === 'Mediabunny'
                ? t('Mediabunny metadata report ({count} lines)', { count: report.rawLog.split('\n').length })
                : t('Raw FFmpeg log ({count} lines)', { count: report.rawLog.split('\n').length })}
            </summary>
            <pre className={styles.rawPre}>{report.rawLog}</pre>
          </details>
        </div>
      )}
    </ToolPage>
  );
}
