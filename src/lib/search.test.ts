import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, LOCALES, setLocale } from './i18n';
import { searchTools } from './search';
import { localizeToolMeta, TOOL_METAS } from '../tools/registry';

const originalLocale = getLocale();

afterEach(() => {
  setLocale(originalLocale);
});

function ids(query: string, limit = 40): string[] {
  return searchTools(query, limit).map((tool) => tool.id);
}

describe('tool search', () => {
  it('understands common task phrases while keeping the action and family together', () => {
    expect(ids('make pdf smaller')[0]).toBe('pdf-compress');
    expect(ids('remove sound from video')[0]).toBe('remove-audio');
    expect(ids('turn png into jpg')[0]).toBe('img-png-to-jpg');
    expect(ids('combine pdf files')[0]).toBe('pdf-merge');
    expect(ids('trim audio')[0]).toBe('audio-trim');
    expect(ids('crop image')[0]).toBe('img-crop');
  });

  it('ranks exact titles first and preserves conversion direction', () => {
    expect(ids('Compress PDF')[0]).toBe('pdf-compress');
    expect(ids('Word to PDF')[0]).toBe('pdf-word-to-pdf');
    expect(ids('PDF to Word')[0]).toBe('pdf-pdf-to-word');
    expect(ids('PDF from Word')[0]).toBe('pdf-word-to-pdf');
  });

  it('keeps password removal and password protection distinct', () => {
    expect(ids('remove pdf password')[0]).toBe('pdf-unlock');
    expect(ids('remove pdf password from pdf')[0]).toBe('pdf-unlock');
    expect(ids('add pdf password')[0]).toBe('pdf-protect');
  });

  it('matches one insertion, deletion, substitution, and adjacent transposition', () => {
    expect(ids('compreess pdf')[0]).toBe('pdf-compress');
    expect(ids('compres pdf')[0]).toBe('pdf-compress');
    expect(ids('comprezs pdf')[0]).toBe('pdf-compress');
    expect(ids('reszie image')[0]).toBe('img-resize');
    expect(ids('merg pdf')[0]).toBe('pdf-merge');
    expect(ids('subtitels')[0]).toBe('subtitles');
  });

  it('supports useful prefixes and keeps short format tokens conservative', () => {
    expect(ids('subti')[0]).toBe('subtitles');
    expect(ids('pff')).toEqual([]);
  });

  it('returns no results for empty, punctuation-only, oversized, or unrelated queries', () => {
    expect(searchTools('')).toEqual([]);
    expect(searchTools('  !!! → / +  ')).toEqual([]);
    expect(searchTools('qzxvwnonsense')).toEqual([]);
    expect(searchTools('not compress pdf')).toEqual([]);
    expect(searchTools('resize '.repeat(20))).toEqual([]);
    expect(searchTools('a'.repeat(33))).toEqual([]);
  });

  it('limits the result count', () => {
    expect(searchTools('pdf', 3)).toHaveLength(3);
    expect(searchTools('pdf', 0)).toEqual([]);
  });

  it('searches canonical English and localized metadata in every supported locale', () => {
    const imageCrop = TOOL_METAS.find((tool) => tool.id === 'img-crop');
    expect(imageCrop).toBeDefined();
    if (!imageCrop) return;

    for (const locale of LOCALES) {
      setLocale(locale);
      expect(ids('compress pdf')[0], locale).toBe('pdf-compress');
      expect(ids('crop image')[0], locale).toBe('img-crop');
      const localizedTitle = localizeToolMeta(imageCrop).title;
      const localizedResult = searchTools(localizedTitle)[0];
      expect(localizedResult?.id, locale).toBe('img-crop');
      expect(localizedResult?.title, locale).toBe(localizedTitle);
    }
  });

  it('matches accented and unaccented localized metadata', () => {
    setLocale('fr');
    expect(ids('métadonnées pdf')[0]).toBe('pdf-metadata-cleaner');
    expect(ids('metadonnees pdf')[0]).toBe('pdf-metadata-cleaner');
  });
});
