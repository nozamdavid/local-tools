import type { SubtitleCue, WhisperChunk } from './types';

export function padZero(n: number, width: number = 2): string {
  return String(Math.floor(n)).padStart(width, '0');
}

export function formatTimestampSrt(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)},${padZero(ms, 3)}`;
}

export function formatTimestampVtt(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}.${padZero(ms, 3)}`;
}

export function formatTimestampDisplay(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  if (hours > 0) {
    return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
  }
  return `${padZero(minutes)}:${padZero(seconds)}`;
}

export function parseTimestamp(str: string): number {
  if (!str) return 0;
  const trimmed = str.trim().replace(',', '.');
  const parts = trimmed.split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (parseFloat(h) || 0) * 3600 + (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
  }
  const direct = parseFloat(trimmed);
  return Number.isFinite(direct) ? direct : 0;
}

export function extractCueTiming(item: WhisperChunk | SubtitleCue, fallbackDuration: number = 3): {
  start: number;
  end: number;
  text: string;
} {
  let start: number;
  let end: number;
  let text: string;

  if ('timestamp' in item) {
    start = Number(item.timestamp[0]) || 0;
    const rawEnd = item.timestamp[1];
    end = rawEnd !== null && rawEnd !== undefined && Number.isFinite(Number(rawEnd))
      ? Number(rawEnd)
      : start + fallbackDuration;
    text = (item.text || '').trim();
  } else {
    start = Number(item.start) || 0;
    end = Number(item.end) || (start + fallbackDuration);
    text = (item.text || '').trim();
  }

  if (end <= start) {
    end = start + 1;
  }

  return { start, end, text };
}

export function toSrt(items: Array<WhisperChunk | SubtitleCue>): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item, index) => {
      const { start, end, text } = extractCueTiming(item);
      return `${index + 1}\n${formatTimestampSrt(start)} --> ${formatTimestampSrt(end)}\n${text}\n`;
    })
    .join('\n');
}

export function toVtt(items: Array<WhisperChunk | SubtitleCue>): string {
  if (!items || items.length === 0) return 'WEBVTT\n\n';
  const body = items
    .map((item, index) => {
      const { start, end, text } = extractCueTiming(item);
      return `${index + 1}\n${formatTimestampVtt(start)} --> ${formatTimestampVtt(end)}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function toPlainText(items: Array<WhisperChunk | SubtitleCue> | string): string {
  if (typeof items === 'string') return items.trim();
  if (!items || items.length === 0) return '';
  return items
    .map((item) => ('text' in item ? item.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

export function toTimestampedText(items: Array<WhisperChunk | SubtitleCue>): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item) => {
      const { start, end, text } = extractCueTiming(item);
      return `[${formatTimestampDisplay(start)} - ${formatTimestampDisplay(end)}] ${text}`;
    })
    .join('\n');
}

export function chunksToCues(chunks: WhisperChunk[], totalDuration?: number): SubtitleCue[] {
  if (!chunks || chunks.length === 0) return [];
  return chunks.map((chunk, index) => {
    const { start, end, text } = extractCueTiming(chunk);
    const safeEnd = totalDuration && end > totalDuration ? totalDuration : end;
    return {
      id: `cue-${index}-${Date.now()}`,
      start: Math.round(start * 100) / 100,
      end: Math.round(safeEnd * 100) / 100,
      text,
    };
  });
}
