import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Field, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta } from '../../lib/media';
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
  const meta = getToolMeta('media-speed');

  const [hours, setHours] = useState<number>(1);
  const [minutes, setMinutes] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);
  const [pasteValue, setPasteValue] = useState<string>('');
  const [customSpeed, setCustomSpeed] = useState<number>(1.5);
  const [targetMinutes, setTargetMinutes] = useState<string>('45');
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

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
    setFileError(null);
    try {
      const vMeta = await getVideoMeta(file);
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
      setFileError('Failed to read duration from the media file.');
    }
  };

  // Build the list of speeds to display:
  // Presets: 0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3 and custom speed
  const allSpeeds = Array.from(new Set([...PRESET_SPEEDS, customSpeed])).filter(
    (s) => s > 0 && Number.isFinite(s)
  );
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
            <span>1. Media Duration</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--accent)' }}>
              Total: {formatTime(totalDurationSeconds)}
            </span>
          </div>

          <div className={styles.durationGrid}>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Hours (h)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={styles.numberInput}
                value={hours}
                onChange={(e) => {
                  setHours(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Minutes (m)</label>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                className={styles.numberInput}
                value={minutes}
                onChange={(e) => {
                  setMinutes(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Seconds (s)</label>
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                className={styles.numberInput}
                value={seconds}
                onChange={(e) => {
                  setSeconds(Math.max(0, parseInt(e.target.value, 10) || 0));
                  setPasteValue('');
                }}
              />
            </div>
          </div>

          <div className={styles.pasteRow}>
            <label className={styles.inputLabel}>Or paste formatted duration (e.g. 1:23:45 or 45:30)</label>
            <input
              type="text"
              className={styles.pasteInput}
              placeholder="Paste duration e.g. 1:30:00"
              value={pasteValue}
              onChange={(e) => handlePasteChange(e.target.value)}
            />
          </div>

          {/* Optional FileDrop */}
          <div className={styles.fileDropWrapper}>
            {loadedFileName ? (
              <div className={styles.fileLoadedBanner}>
                <span>✓ Duration auto-filled from: <strong>{loadedFileName}</strong></span>
                <Button
                  variant="secondary"
                  onClick={() => setLoadedFileName(null)}
                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <FileDrop
                accept="video/*,audio/*"
                label="Optional: Drop video or audio file to auto-fill duration"
                hint="Read completely in your browser via HTML5 video metadata"
                onFiles={handleFileDrop}
              />
            )}
            {fileError && <div className="error-banner" style={{ marginTop: '0.75rem' }}>{fileError}</div>}
          </div>
        </div>

        {/* Custom Speed Control */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>2. Custom Playback Speed</span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)' }}>
              {customSpeed}x
            </span>
          </div>

          <Field label="Custom Speed Multiplier" hint="Select or enter any playback speed (e.g. 1.35x, 2.25x)">
            <div className={styles.speedRow}>
              <input
                id={customSpeedInputId}
                type="number"
                min="0.1"
                max="10"
                step="0.05"
                className={styles.numberInput}
                value={customSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) setCustomSpeed(val);
                }}
              />
              <Slider
                value={customSpeed}
                min={0.25}
                max={4}
                step={0.05}
                unit="x"
                onChange={setCustomSpeed}
              />
            </div>
          </Field>
        </div>

        {/* Speed Comparison Table */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <span>3. Playback Speed Comparison</span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.speedTable}>
              <thead>
                <tr>
                  <th>Speed</th>
                  <th>Resulting Duration</th>
                  <th>Time Saved / Difference</th>
                  <th>Percent Saved</th>
                </tr>
              </thead>
              <tbody>
                {allSpeeds.map((spd) => {
                  const newDuration = totalDurationSeconds / spd;
                  const timeDiff = totalDurationSeconds - newDuration;
                  const isCustom = spd === customSpeed && !PRESET_SPEEDS.includes(spd);

                  let diffDisplay: React.ReactNode = null;
                  let percentDisplay = '';

                  if (spd > 1) {
                    const pct = ((1 - 1 / spd) * 100).toFixed(1);
                    diffDisplay = (
                      <span className={styles.savedBadge}>
                        Saved {formatTime(timeDiff)}
                      </span>
                    );
                    percentDisplay = `-${pct}%`;
                  } else if (spd < 1) {
                    const pct = ((1 / spd - 1) * 100).toFixed(1);
                    diffDisplay = (
                      <span className={styles.extraBadge}>
                        +{formatTime(Math.abs(timeDiff))} extra
                      </span>
                    );
                    percentDisplay = `+${pct}%`;
                  } else {
                    diffDisplay = <span className={styles.normalBadge}>Baseline (Normal)</span>;
                    percentDisplay = '0%';
                  }

                  return (
                    <tr
                      key={spd}
                      className={spd === customSpeed ? styles.customRow : undefined}
                    >
                      <td>
                        <strong>{spd}x</strong>
                        {isCustom && <span className={styles.badgeCustom}>Custom</span>}
                        {spd === customSpeed && !isCustom && (
                          <span className={styles.badgeCustom}>Selected</span>
                        )}
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
            <span>4. Reverse Mode: "I have X minutes, what speed do I need?"</span>
          </div>

          <Field
            label="Available Time (in minutes)"
            hint="Enter how many minutes you have available to watch or listen"
          >
            <input
              id={targetMinutesId}
              type="number"
              min="1"
              step="1"
              className={styles.numberInput}
              style={{ maxWidth: '240px' }}
              value={targetMinutes}
              onChange={(e) => setTargetMinutes(e.target.value)}
              placeholder="e.g. 45"
            />
          </Field>

          {reverseSpeed !== null && totalDurationSeconds > 0 && (
            <div className={styles.reverseResult}>
              <div className={styles.reverseHighlight}>
                {reverseSpeed.toFixed(2)}x
              </div>
              <p className={styles.reverseDesc}>
                {reverseSpeed > 1 ? (
                  <>
                    To finish a <strong>{formatTime(totalDurationSeconds)}</strong> media in{' '}
                    <strong>{parsedTargetMinutes} minutes</strong>, you need to play it at{' '}
                    <strong>{reverseSpeed.toFixed(2)}x speed</strong> (saves{' '}
                    {formatTime(totalDurationSeconds - parsedTargetMinutes * 60)}).
                  </>
                ) : (
                  <>
                    You have plenty of time! At normal 1.0x speed, the media finishes in{' '}
                    <strong>{formatTime(totalDurationSeconds)}</strong>, leaving you with{' '}
                    <strong>
                      {(parsedTargetMinutes - totalDurationSeconds / 60).toFixed(1)} minutes
                    </strong>{' '}
                    to spare. You could even slow it down to{' '}
                    <strong>{reverseSpeed.toFixed(2)}x</strong>.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </ToolPage>
  );
}
