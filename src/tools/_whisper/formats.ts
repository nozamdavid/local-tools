import type { SubtitleCue, WhisperChunk } from './types';
import { translate } from '../../lib/i18n';

export type SubtitleFormat = 'srt' | 'vtt';

export const MAX_SUBTITLE_FILE_CHARS = 5_000_000;
export const MAX_SUBTITLE_FILE_BYTES = 5_000_000;
export const MAX_SUBTITLE_CUES = 10_000;
export const MAX_SUBTITLE_CUE_TEXT_CHARS = 10_000;
export const MAX_SUBTITLE_TIME_SECONDS = 7 * 24 * 60 * 60;

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  metadata: {
    headerMetadata: boolean;
    ignoredBlocks: string[];
    hasCueSettings: boolean;
    hasCueMarkup: boolean;
  };
}

export function padZero(n: number, width: number = 2): string {
  return String(Math.floor(n)).padStart(width, '0');
}

export function formatTimestampSrt(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)},${padZero(ms, 3)}`;
}

export function formatTimestampVtt(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
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

function parseStrictTimestamp(timestamp: string, format: SubtitleFormat): number | null {
  const match =
    format === 'srt'
      ? /^(?:(\d+):)?(\d{1,2}):([0-5]\d)[,.](\d{1,3})$/.exec(timestamp)
      : /^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(timestamp);
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, '0'));
  if (!Number.isFinite(hours) || minutes > 59) return null;

  const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  return Number.isFinite(total) && total <= MAX_SUBTITLE_TIME_SECONDS ? total : null;
}

function decodeVttText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|lrm|rlm|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
    const name = entity.slice(1, -1).toLowerCase();
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'lrm') return '\u200e';
    if (name === 'rlm') return '\u200f';
    if (name === 'nbsp') return '\u00a0';
    const value = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return entity;
    return String.fromCodePoint(value);
  });
}

function splitBlocks(text: string): string[] {
  return text
    .split(/\n[\t ]*\n+/)
    .map((block) => block.replace(/\n+$/, ''))
    .filter((block) => block.trim().length > 0);
}

function parseTimingLine(line: string, format: SubtitleFormat): { start: number; end: number; settings?: string } | null {
  const match = /^\s*(\S+)[\t ]+-->[\t ]+(\S+)(?:[\t ]+(.*))?\s*$/.exec(line);
  if (!match) return null;
  if (format === 'srt' && match[3]?.trim()) return null;
  const start = parseStrictTimestamp(match[1], format);
  const end = parseStrictTimestamp(match[2], format);
  if (start === null || end === null || end <= start) return null;
  const settings = format === 'vtt' ? match[3]?.trim() || undefined : undefined;
  return { start, end, settings };
}

/** Parse an SRT or WebVTT sidecar into editable cues without loading a media engine. */
export function parseSubtitles(input: string, format: SubtitleFormat): ParsedSubtitles {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.length > MAX_SUBTITLE_FILE_CHARS) {
    throw new Error(
      translate('Subtitle file is too large (maximum {size} characters).', { size: MAX_SUBTITLE_FILE_CHARS.toLocaleString() }),
    );
  }

  let cueText = text;
  const metadata = { headerMetadata: false, ignoredBlocks: [] as string[], hasCueSettings: false, hasCueMarkup: false };

  if (format === 'vtt') {
    const lines = text.split('\n');
    if (!/^WEBVTT(?:[\t ].*)?$/.test(lines[0] ?? '')) throw new Error(translate('WebVTT files must start with a WEBVTT header.'));
    metadata.headerMetadata = (lines[0]?.length ?? 0) > 'WEBVTT'.length;
    let bodyStart = 1;
    while (bodyStart < lines.length && lines[bodyStart].trim() !== '') {
      metadata.headerMetadata = true;
      bodyStart++;
    }
    if (bodyStart === lines.length) cueText = '';
    else cueText = lines.slice(bodyStart + 1).join('\n');
  }

  const cues: SubtitleCue[] = [];
  for (const block of splitBlocks(cueText)) {
    const lines = block.split('\n');
    const marker = lines[0].trim();
    const ignoredBlock = /^(NOTE(?:[\t ]|$)|STYLE$|REGION$)/.exec(marker)?.[1]?.trim();
    if (format === 'vtt' && ignoredBlock) {
      const kind = ignoredBlock.startsWith('NOTE') ? 'NOTE' : ignoredBlock;
      if (!metadata.ignoredBlocks.includes(kind)) metadata.ignoredBlocks.push(kind);
      continue;
    }

    let timingLineIndex = 0;
    let sourceId: string | undefined;
    let timing = parseTimingLine(lines[0], format);
    if (!timing) {
      if (lines.length < 2) throw new Error(translate('Cue {number}: missing or malformed timestamp line.', { number: cues.length + 1 }));
      sourceId = lines[0];
      timingLineIndex = 1;
      timing = parseTimingLine(lines[1], format);
      if (!timing) throw new Error(translate('Cue {number}: malformed timestamp line.', { number: cues.length + 1 }));
    }

    if (cues.length >= MAX_SUBTITLE_CUES) {
      throw new Error(translate('Subtitle files may contain at most {count} cues.', { count: MAX_SUBTITLE_CUES.toLocaleString() }));
    }
    const cueBody = lines.slice(timingLineIndex + 1).join('\n');
    if (cueBody.length > MAX_SUBTITLE_CUE_TEXT_CHARS) {
      throw new Error(
        translate('Cue {number}: text exceeds {count} characters.', {
          number: cues.length + 1,
          count: MAX_SUBTITLE_CUE_TEXT_CHARS.toLocaleString(),
        }),
      );
    }
    if (timing.settings) metadata.hasCueSettings = true;
    const cueText = format === 'vtt' ? decodeVttText(cueBody) : cueBody;
    if (format === 'vtt' && /<\/?(?:b|i|u|ruby|rt|v|lang|c)(?:[.\t >])|<\d{2,}:/i.test(cueBody)) {
      metadata.hasCueMarkup = true;
    }
    cues.push({
      id: `imported-cue-${cues.length}`,
      start: timing.start,
      end: timing.end,
      text: cueText,
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(timing.settings === undefined ? {} : { settings: timing.settings }),
    });
  }

  if (cues.length === 0) throw new Error(translate('No subtitle cues were found in this file.'));
  return { format, cues, metadata };
}

/** Validate edited cues before shifting or exporting them. */
export function validateSubtitleCues(cues: SubtitleCue[]): void {
  if (cues.length > MAX_SUBTITLE_CUES) {
    throw new Error(translate('Subtitle files may contain at most {count} cues.', { count: MAX_SUBTITLE_CUES.toLocaleString() }));
  }
  cues.forEach((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) {
      throw new Error(translate('Cue {number}: timestamps must be finite numbers.', { number: index + 1 }));
    }
    if (cue.start < 0 || cue.end > MAX_SUBTITLE_TIME_SECONDS || cue.end <= cue.start) {
      throw new Error(
        translate('Cue {number}: timestamps must be non-negative, within seven days, and end after start.', { number: index + 1 }),
      );
    }
    if (typeof cue.text !== 'string' || cue.text.length > MAX_SUBTITLE_CUE_TEXT_CHARS) {
      throw new Error(
        translate('Cue {number}: text must be at most {count} characters.', {
          number: index + 1,
          count: MAX_SUBTITLE_CUE_TEXT_CHARS.toLocaleString(),
        }),
      );
    }
  });
}

/** Shift every cue together; reject the whole edit if any cue would cross zero. */
export function shiftSubtitleCues(cues: SubtitleCue[], shiftSeconds: number): SubtitleCue[] {
  if (!Number.isFinite(shiftSeconds)) throw new Error(translate('Shift must be a finite number of seconds.'));
  validateSubtitleCues(cues);
  const shifted = cues.map((cue, index) => {
    const start = cue.start + shiftSeconds;
    const end = cue.end + shiftSeconds;
    if (start < 0) throw new Error(translate('Shift rejected: cue {number} would start before 00:00:00.', { number: index + 1 }));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end > MAX_SUBTITLE_TIME_SECONDS || end <= start) {
      throw new Error(translate('Shift rejected: cue {number} would have invalid timing.', { number: index + 1 }));
    }
    return { ...cue, start, end };
  });
  return shifted;
}

export function extractCueTiming(
  item: WhisperChunk | SubtitleCue,
  fallbackDuration: number = 3,
): {
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
    end = rawEnd !== null && rawEnd !== undefined && Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : start + fallbackDuration;
    text = (item.text || '').trim();
  } else {
    start = Number(item.start) || 0;
    end = Number(item.end) || start + fallbackDuration;
    text = (item.text || '').trim();
  }

  if (end <= start) {
    end = start + 1;
  }

  return { start, end, text };
}

export function toSrt(items: Array<WhisperChunk | SubtitleCue>): string {
  if (!items || items.length === 0) return '';
  if (items.length > MAX_SUBTITLE_CUES) {
    throw new Error(translate('Subtitle files may contain at most {count} cues.', { count: MAX_SUBTITLE_CUES.toLocaleString() }));
  }
  return items
    .map((item, index) => {
      const { start, end, text } = extractCueTiming(item);
      if ('start' in item) validateSubtitleCues([item]);
      const cueId = 'start' in item ? (item.sourceId ?? String(index + 1)) : String(index + 1);
      const cueText = 'start' in item ? item.text : text;
      return `${cueId}\n${formatTimestampSrt(start)} --> ${formatTimestampSrt(end)}\n${cueText}\n`;
    })
    .join('\n');
}

export function toVtt(items: Array<WhisperChunk | SubtitleCue>): string {
  if (!items || items.length === 0) return 'WEBVTT\n\n';
  if (items.length > MAX_SUBTITLE_CUES) {
    throw new Error(translate('Subtitle files may contain at most {count} cues.', { count: MAX_SUBTITLE_CUES.toLocaleString() }));
  }
  const body = items
    .map((item, index) => {
      const { start, end, text } = extractCueTiming(item);
      if ('start' in item) validateSubtitleCues([item]);
      const cueId = 'start' in item ? (item.sourceId ?? String(index + 1)) : String(index + 1);
      const cueText = 'start' in item ? item.text : text;
      const settings = 'start' in item && item.settings ? ` ${item.settings}` : '';
      const safeText = cueText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `${cueId}\n${formatTimestampVtt(start)} --> ${formatTimestampVtt(end)}${settings}\n${safeText}\n`;
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
