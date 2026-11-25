import { useState, useId, useRef, useEffect, useCallback } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Field, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta } from '../../lib/media';
import { useI18n } from '../../lib/i18n';
import { useObjectUrl } from '../../lib/useObjectUrl';
import styles from './Tool.module.css';

const PRESET_SPEEDS = [0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3];

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0s';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function parseDurationString(text: string): { h: number; m: number; s: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Colon-separated: HH:MM:SS or MM:SS or SS
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => parseFloat(p));
    if (parts.some((p) => isNaN(p))) return null;
    if (parts.length === 3) {
      return { h: Math.max(0, parts[0]), m: Math.max(0, parts[1]), s: Math.max(0, parts[2]) };
    }
    if (parts.length === 2) {
      return { h: 0, m: Math.max(0, parts[0]), s: Math.max(0, parts[1]) };
    }
    if (parts.length === 1) {
      return { h: 0, m: 0, s: Math.max(0, parts[0]) };
    }
  }

  // e.g. 1h 23m 45s or 45m
  const hMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/i);
  const mMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?/i);
  const sMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/i);
  if (hMatch || mMatch || sMatch) {
    return {
      h: hMatch ? parseFloat(hMatch[1]) : 0,
      m: mMatch ? parseFloat(mMatch[1]) : 0,
      s: sMatch ? parseFloat(sMatch[1]) : 0,
    };
  }

  // Pure number (seconds)
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0) {
    const h = Math.floor(num / 3600);
    const m = Math.floor((num % 3600) / 60);
    const s = Math.round(num % 60);
    return { h, m, s };
  }

  return null;
}

export default function MediaSpeedTool() {
  const { t } = useI18n();
  const meta = getToolMeta('media-speed');

  const [hours, setHours] = useState<number>(1);
  const [minutes, setMinutes] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);
  const [pasteValue, setPasteValue] = useState<string>('');
  const [customSpeed, setCustomSpeed] = useState<number>(1.5);
  const [previewRateUnsupported, setPreviewRateUnsupported] = useState(false);
  const [targetMinutes, setTargetMinutes] = useState<string>('45');
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewPlaybackError, setPreviewPlaybackError] = useState(false);
  const metadataRequestRef = useRef(0);
  const previewMediaRef = useRef<HTMLMediaElement | null>(null);
  const previewUrl = useObjectUrl(previewFile);

  const customSpeedInputId = useId();
  const targetMinutesId = useId();

  const totalDurationSeconds = Math.max(0, hours * 3600 + minutes * 60 + seconds);

  const handlePasteChange = (val: string) => {
    setPasteValue(val);
    const parsed = parseDurationString(val);
    if (parsed) {
      setHours(parsed.h);
      setMinutes(parsed.m);
      setSeconds(parsed.s);
    }
  };

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const requestId = ++metadataRequestRef.current;
    previewMediaRef.current?.pause();
    setPreviewFile(file);
    setPreviewLoaded(false);
    setPreviewPlaybackError(false);
    setLoadedFileName(null);
    setFileError(null);
    try {
      const vMeta = await getVideoMeta(file);
      if (requestId !== metadataRequestRef.current) return;
      if (vMeta.duration && vMeta.duration > 0) {
        const total = Math.round(vMeta.duration);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        setHours(h);
        setMinutes(m);
        setSeconds(s);
        setPasteValue('');
        setLoadedFileName(`${file.name} (${formatTime(vMeta.duration)})`);
      } else {
        setFileError('Could not determine duration from this media file.');
      }
    } catch {
      if (requestId !== metadataRequestRef.current) return;
      setFileError('Failed to read duration from the media file.');
    }
  };

  const syncPreviewPlayback = useCallback(
    (media: HTMLMediaElement) => {
      try {
        media.playbackRate = customSpeed;
        setPreviewRateUnsupported(Math.abs(media.playbackRate - customSpeed) > 0.001);
      } catch {
        setPreviewRateUnsupported(true);
      }
      media.preservesPitch = true;
      const extendedMedia = media as HTMLMediaElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
      if ('webkitPreservesPitch' in extendedMedia) extendedMedia.webkitPreservesPitch = true;
      if ('mozPreservesPitch' in extendedMedia) extendedMedia.mozPreservesPitch = true;
    },
    [customSpeed],
  );

  useEffect(() => {
    if (previewMediaRef.current) syncPreviewPlayback(previewMediaRef.current);
  }, [syncPreviewPlayback, previewUrl]);

  // Build the list of speeds to display:
  // Presets: 0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3 and custom speed
  const allSpeeds = Array.from(new Set([...PRESET_SPEEDS, customSpeed])).filter((s) => s > 0 && Number.isFinite(s));
  allSpeeds.sort((a, b) => a - b);

  // Reverse mode calculation
  const parsedTargetMinutes = parseFloat(targetMinutes);
  let reverseSpeed: number | null = null;
  if (!isNaN(parsedTargetMinutes) && parsedTargetMinutes > 0 && totalDurationSeconds > 0) {
    reverseSpeed = totalDurationSeconds / (parsedTargetMinutes * 60);
  }

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="media-speed">
      <div className={styles.container}>
        {/* Duration Input Card */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>{t('1. Media Duration')}</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--accent-text)' }}>
              {t('Total:')} {formatTime(totalDurationSeconds)}
            </span>
          </div>

          <div className={styles.durationGrid}>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>{t('Hours (h)')}</label>
              <input
                type="number"
                min="0"
                step="1"
                className={styles.numberInput}
                value={hours}
                aria-label={t('Hours')}
                onChange={(e) => {
                  setHours(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>{t('Minutes (m)')}</label>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                className={styles.numberInput}
                value={minutes}
                aria-label={t('Minutes')}
                onChange={(e) => {
                  setMinutes(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>{t('Seconds (s)')}</label>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                className={styles.numberInput}
                value={seconds}
                aria-label={t('Seconds')}
                onChange={(e) => {
                  setSeconds(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
          </div>

          <div className={styles.pasteRow}>
            <label className={styles.inputLabel}>{t('Or paste formatted duration (e.g. 1:23:45 or 45:30)')}</label>
            <input
              type="text"
              className={styles.pasteInput}
              placeholder={t('Paste duration e.g. 1:30:00')}
              value={pasteValue}
              aria-label={t('Paste formatted duration')}
              onChange={(e) => handlePasteChange(e.target.value)}
            />
          </div>

          {/* Optional FileDrop */}
          <div className={styles.fileDropWrapper}>
            {loadedFileName ? (
              <div className={styles.fileLoadedBanner}>
                <span>
                  ✓ {t('Duration auto-filled from:')} <strong>{loadedFileName}</strong>
                </span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    metadataRequestRef.current += 1;
                    setLoadedFileName(null);
                    setPreviewFile(null);
                    previewMediaRef.current?.pause();
                    setPreviewLoaded(false);
                    setPreviewPlaybackError(false);
                    setFileError(null);
                  }}
                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                >
                  {t('Clear')}
                </Button>
              </div>
            ) : (
              <FileDrop
                accept="video/*,audio/*"
                label={t('Optional: Drop video or audio file to auto-fill duration')}
                hint={t('Read completely in your browser via HTML5 video metadata')}
                onFiles={handleFileDrop}
              />
            )}
            {fileError && (
              <div className="error-banner" style={{ marginTop: '0.75rem' }}>
                {t(fileError)}
              </div>
            )}
          </div>

          {previewFile && (
            <section className={styles.previewCard} aria-label={t('Speed preview')}>
              <div className={styles.cardTitle}>
                <span>{t('Speed preview')}</span>
                <span>{customSpeed}x</span>
              </div>
              {previewUrl &&
                (previewFile.type.startsWith('audio/') ? (
                  <audio
                    ref={(element) => {
                      previewMediaRef.current = element;
                    }}
                    controls
                    preload="metadata"
                    src={previewUrl}
                    className={styles.previewAudio}
                    onLoadedMetadata={(event) => {
                      syncPreviewPlayback(event.currentTarget);
                      setPreviewLoaded(true);
                    }}
                    onPlay={(event) => syncPreviewPlayback(event.currentTarget)}
                    onError={() => setPreviewPlaybackError(true)}
                  />
                ) : (
                  <video
                    ref={(element) => {
                      previewMediaRef.current = element;
                    }}
                    controls
                    playsInline
                    preload="metadata"
                    src={previewUrl}
                    className="preview-media"
                    onLoadedMetadata={(event) => {
                      syncPreviewPlayback(event.currentTarget);
                      setPreviewLoaded(true);
                    }}
                    onPlay={(event) => syncPreviewPlayback(event.currentTarget)}
                    onError={() => setPreviewPlaybackError(true)}
                  />
                ))}
              {previewUrl && !previewLoaded && !previewPlaybackError && (
                <p className={styles.previewNote} role="status">
                  {t('Loading source preview...')}
                </p>
              )}
              <p className={styles.previewNote}>{t('Preview uses browser playbackRate. Pitch correction follows browser support.')}</p>
              {previewPlaybackError && <p className={styles.previewNote}>{t('The browser could not play this source file.')}</p>}
              {previewRateUnsupported && (
                <p className={styles.previewNote} role="status">
                  {t('The browser cannot preview the selected playback speed.')}
                </p>
              )}
            </section>
          )}
        </div>

        {/* Custom Speed Control */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>{t('2. Custom Playback Speed')}</span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-text)' }}>{customSpeed}x</span>
          </div>

          <Field label={t('Custom Speed Multiplier')} hint={t('Select or enter any playback speed (e.g. 1.35x, 2.25x)')}>
            <div className={styles.speedRow}>
              <input
                id={customSpeedInputId}
                type="number"
                min="0.1"
                max="10"
                step="0.05"
                className={styles.numberInput}
                value={customSpeed}
                aria-label={t('Custom speed multiplier')}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) setCustomSpeed(Math.min(10, Math.max(0.1, val)));
                }}
              />
              <Slider
                value={customSpeed}
                min={0.25}
                max={4}
                step={0.05}
                unit="x"
                aria-label={t('Custom speed multiplier')}
                onChange={setCustomSpeed}
              />
            </div>
          </Field>
        </div>

        {/* Speed Comparison Table */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>{t('3. Playback Speed Comparison')}</span>
          </div>

          <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label={t('Playback speed comparison table')}>
            <table className={styles.speedTable}>
              <thead>
                <tr>
                  <th>{t('Speed')}</th>
                  <th>{t('Resulting Duration')}</th>
                  <th>{t('Time Saved / Difference')}</th>
                  <th>{t('Percent Saved')}</th>
                </tr>
              </thead>
              <tbody>
                {allSpeeds.map((spd) => {
                  const newDuration = totalDurationSeconds / spd;
                  const timeDiff = totalDurationSeconds - newDuration;
                  const isCustom = spd === customSpeed && !PRESET_SPEEDS.includes(spd);

                  let diffDisplay: React.ReactNode;
                  let percentDisplay: string;

                  if (spd > 1) {
                    const pct = ((1 - 1 / spd) * 100).toFixed(1);
                    diffDisplay = <span className={styles.savedBadge}>{t('Saved {time}', { time: formatTime(timeDiff) })}</span>;
                    percentDisplay = `-${pct}%`;
                  } else if (spd < 1) {
                    const pct = ((1 / spd - 1) * 100).toFixed(1);
                    diffDisplay = <span className={styles.extraBadge}>{t('+{time} extra', { time: formatTime(Math.abs(timeDiff)) })}</span>;
                    percentDisplay = `+${pct}%`;
                  } else {
                    diffDisplay = <span className={styles.normalBadge}>{t('Baseline (Normal)')}</span>;
                    percentDisplay = '0%';
                  }

                  return (
                    <tr key={spd} className={spd === customSpeed ? styles.customRow : undefined}>
                      <td>
                        <strong>{spd}x</strong>
                        {isCustom && <span className={styles.badgeCustom}>{t('Custom')}</span>}
                        {spd === customSpeed && !isCustom && <span className={styles.badgeCustom}>{t('Selected')}</span>}
                      </td>
                      <td>
                        <strong>{formatTime(newDuration)}</strong>
                      </td>
                      <td>{diffDisplay}</td>
                      <td>{percentDisplay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reverse Mode Card */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>{t('4. Reverse Mode: "I have X minutes, what speed do I need?"')}</span>
          </div>

          <Field label={t('Available Time (in minutes)')} hint={t('Enter how many minutes you have available to watch or listen')}>
            <input
              id={targetMinutesId}
              type="number"
              min="1"
              step="1"
              className={styles.numberInput}
              style={{ maxWidth: '240px' }}
              value={targetMinutes}
              onChange={(e) => setTargetMinutes(e.target.value)}
              placeholder={t('e.g. 45')}
            />
          </Field>

          {reverseSpeed !== null && totalDurationSeconds > 0 && (
            <div className={styles.reverseResult}>
              <div className={styles.reverseHighlight}>{reverseSpeed.toFixed(2)}x</div>
              <p className={styles.reverseDesc}>
                {reverseSpeed > 1
                  ? t('To finish a {duration} media in {minutes} minutes, you need to play it at {speed} speed (saves {saved}).', {
                      duration: formatTime(totalDurationSeconds),
                      minutes: parsedTargetMinutes,
                      speed: `${reverseSpeed.toFixed(2)}x`,
                      saved: formatTime(totalDurationSeconds - parsedTargetMinutes * 60),
                    })
                  : t(
                      'You have plenty of time! At normal 1.0x speed, the media finishes in {duration}, leaving you with {minutes} minutes to spare. You could even slow it down to {speed}.',
                      {
                        duration: formatTime(totalDurationSeconds),
                        minutes: (parsedTargetMinutes - totalDurationSeconds / 60).toFixed(1),
                        speed: `${reverseSpeed.toFixed(2)}x`,
                      },
                    )}
              </p>
            </div>
          )}
        </div>
      </div>
    </ToolPage>
  );
}
