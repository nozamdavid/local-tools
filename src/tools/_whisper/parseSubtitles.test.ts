import { describe, expect, it } from 'vitest';
import {
  MAX_SUBTITLE_CUE_TEXT_CHARS,
  MAX_SUBTITLE_CUES,
  MAX_SUBTITLE_FILE_CHARS,
  parseSubtitles,
  shiftSubtitleCues,
  toSrt,
  toVtt,
} from './formats';

describe('subtitle sidecar parsing and export', () => {
  it('reads SRT with a BOM, CRLF, hours, optional cue IDs, and multiline text', () => {
    const parsed = parseSubtitles('\uFEFFchapter-one\r\n01:02:03,125 --> 01:02:05,500\r\nFirst line\r\nSecond line\r\n', 'srt');

    expect(parsed.cues).toEqual([
      {
        id: 'imported-cue-0',
        sourceId: 'chapter-one',
        start: 3723.125,
        end: 3725.5,
        text: 'First line\nSecond line',
      },
    ]);
  });

  it('accepts cues without an identifier', () => {
    const parsed = parseSubtitles('00:00:01,000 --> 00:00:02,000\nCaption text', 'srt');
    expect(parsed.cues[0]).toMatchObject({ start: 1, end: 2, text: 'Caption text' });
    expect(parsed.cues[0].sourceId).toBeUndefined();
  });

  it('reads WebVTT minute timestamps and skips NOTE, STYLE, REGION, and header metadata blocks', () => {
    const parsed = parseSubtitles(
      [
        'WEBVTT - sample captions',
        'Kind: captions',
        '',
        'cue-a',
        '01:02.125 --> 01:04.250 align:start position:20%',
        'A &lt;line&gt;',
        'next line',
        '',
        'NOTE author comment',
        'This block is metadata.',
        '',
        'STYLE',
        '::cue { color: lime; }',
        '',
        'REGION',
        'id:region-1',
      ].join('\n'),
      'vtt',
    );

    expect(parsed.cues).toEqual([
      {
        id: 'imported-cue-0',
        sourceId: 'cue-a',
        start: 62.125,
        end: 64.25,
        text: 'A <line>\nnext line',
        settings: 'align:start position:20%',
      },
    ]);
    expect(parsed.metadata).toEqual({
      headerMetadata: true,
      ignoredBlocks: ['NOTE', 'STYLE', 'REGION'],
      hasCueSettings: true,
      hasCueMarkup: false,
    });
  });

  it('round-trips SRT and VTT cues through the production serializers', () => {
    const srt = parseSubtitles('42\n00:00:01,250 --> 00:00:03,000\nA line\nwith a second line\n', 'srt');
    const vtt = parseSubtitles('WEBVTT\n\ncaption-9\n00:01.250 --> 00:03.000 align:center\n<b>Literal &lt;tag&gt;</b>\n', 'vtt');

    expect(parseSubtitles(toSrt(srt.cues), 'srt').cues).toEqual(srt.cues);
    expect(parseSubtitles(toVtt(vtt.cues), 'vtt').cues).toEqual(vtt.cues);
    expect(vtt.metadata.hasCueMarkup).toBe(true);
    expect(toVtt(vtt.cues)).toContain('&lt;b&gt;Literal &lt;tag&gt;&lt;/b&gt;');
  });

  it('preserves millisecond timing without floating-point truncation', () => {
    const parsed = parseSubtitles('1\n00:00:01,001 --> 00:00:02,003\ntext\n', 'srt');
    expect(parseSubtitles(toSrt(parsed.cues), 'srt').cues).toEqual(parsed.cues);
    expect(parseSubtitles(toVtt(parsed.cues), 'vtt').cues).toEqual(parsed.cues);
  });

  it('rejects malformed timestamps and cues with invalid timing', () => {
    expect(() => parseSubtitles('1\n00:00:xx,000 --> 00:00:02,000\ntext', 'srt')).toThrow(/malformed timestamp/i);
    expect(() => parseSubtitles('1\n00:00:03,000 --> 00:00:02,000\ntext', 'srt')).toThrow(/malformed timestamp/i);
    expect(() => parseSubtitles('1\n168:00:00,001 --> 168:00:01,000\ntext', 'srt')).toThrow(/malformed timestamp/i);
    expect(() => parseSubtitles('not a VTT file', 'vtt')).toThrow(/WEBVTT header/i);
    expect(() => parseSubtitles('WEBVTT\n\n00:04.000 --> 00:03.000\ntext', 'vtt')).toThrow(/malformed timestamp/i);
    expect(() => toSrt([{ id: 'bad', start: Number.NaN, end: 1, text: 'text' }])).toThrow(/finite/i);
    expect(() => toVtt([{ id: 'bad', start: 1, end: 1, text: 'text' }])).toThrow(/end after start/i);
  });

  it('warns when inline VTT timestamps with long hours become literal text', () => {
    const parsed = parseSubtitles('WEBVTT\n\n100:00:00.000 --> 100:00:02.000\nword <100:00:01.000>word', 'vtt');
    expect(parsed.metadata.hasCueMarkup).toBe(true);
    expect(toVtt(parsed.cues)).toContain('&lt;100:00:01.000&gt;');
  });

  it('enforces file, cue-count, and cue-text bounds', () => {
    expect(() => parseSubtitles('x'.repeat(MAX_SUBTITLE_FILE_CHARS + 1), 'srt')).toThrow(/too large/i);
    expect(() => parseSubtitles(`1\n00:00:00,000 --> 00:00:01,000\n${'x'.repeat(MAX_SUBTITLE_CUE_TEXT_CHARS + 1)}`, 'srt')).toThrow(
      /text exceeds/i,
    );

    const tooManyCues = Array.from({ length: MAX_SUBTITLE_CUES + 1 }, (_, index) => `${index + 1}\n00:00:00,000 --> 00:00:01,000\nx`).join(
      '\n\n',
    );
    expect(() => parseSubtitles(tooManyCues, 'srt')).toThrow(/at most/i);
  });

  it('shifts every cue by finite seconds and rejects negative starts', () => {
    const cues = parseSubtitles('1\n00:00:02,000 --> 00:00:03,000\nfirst\n\n2\n00:00:04,000 --> 00:00:05,000\nsecond', 'srt').cues;

    expect(shiftSubtitleCues(cues, 1.5).map(({ start, end }) => [start, end])).toEqual([
      [3.5, 4.5],
      [5.5, 6.5],
    ]);
    expect(shiftSubtitleCues(cues, -1).map(({ start, end }) => [start, end])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(() => shiftSubtitleCues(cues, Number.NaN)).toThrow(/finite/i);
    expect(() => shiftSubtitleCues(cues, -2.1)).toThrow(/before 00:00:00/i);
  });
});
