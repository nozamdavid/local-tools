import { afterEach, describe, expect, it } from 'vitest';
import { categories, TOOL_METAS } from '../tools/registry';
import { MEDIA_LIST } from '../design/media';
import { formatBytes, formatDuration } from './format';
import { getLocale, LOCALES, messagesByLocale, resolveLocale, setLocale, translate, type Locale } from './i18n';

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  setLocale('en');
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('locale resolution and persistence', () => {
  it('prefers a valid saved locale, then the first supported browser language', () => {
    expect(resolveLocale('fr', ['es-MX', 'de-DE'])).toBe('fr');
    expect(resolveLocale('xx', ['ja-JP', 'it-IT', 'fr-FR'])).toBe('it');
    expect(resolveLocale(null, ['nl-NL', 'pt-BR'])).toBe('pt');
    expect(resolveLocale(undefined, ['nl-NL'])).toBe('en');
  });

  it('persists explicit choices and keeps them in memory when storage throws', () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    setLocale('pt');
    expect(values.get('loconvert-locale')).toBe('pt');
    expect(getLocale()).toBe('pt');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
      },
    });
    expect(() => setLocale('fr')).not.toThrow();
    expect(getLocale()).toBe('fr');
  });
});

describe('translations', () => {
  it('translates dynamic labels and preserves interpolation fields in all catalogs', () => {
    const placeholders = (value: string) => [...new Set(value.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) ?? [])].sort();
    for (const locale of LOCALES.filter((value) => value !== 'en')) {
      setLocale(locale);
      expect(translate('{count} times ({count}x)', { count: 3 })).not.toContain('{count}');
      expect(translate('Enter a whole number of pages, 1 or more.')).not.toBe('Enter a whole number of pages, 1 or more.');
      for (const [source, translated] of Object.entries(messagesByLocale[locale])) {
        expect(placeholders(translated), `${locale}: ${source}`).toEqual(placeholders(source));
      }
    }
  });

  it('interpolates named values and leaves unknown placeholders intact', () => {
    setLocale('es');
    expect(translate('Continue with {tool}', { tool: 'PDF' })).toBe('Continuar con PDF');
    expect(translate('A {known} {missing}', { known: 3 })).toBe('A 3 {missing}');
    expect(translate('constructor')).toBe('constructor');
  });

  it('formats decimal values using the selected locale', () => {
    setLocale('fr');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatDuration(62.5)).toBe('1:02,5');
    expect(formatDuration(5)).toBe('0:05,0');
    expect(formatDuration(Number.NaN)).toBe('0:00,0');
    setLocale('en');
    expect(formatDuration(5)).toBe('0:05.0');
  });

  it('keeps the same source keys in every supported locale and covers catalog metadata', () => {
    const translatedLocales = LOCALES.filter((locale) => locale !== 'en');
    const sourceKeys = Object.keys(messagesByLocale[translatedLocales[0]]).sort();
    for (const locale of translatedLocales) {
      expect(Object.keys(messagesByLocale[locale]).sort()).toEqual(sourceKeys);
    }

    const metadata = [...categories, ...TOOL_METAS, ...MEDIA_LIST];
    for (const locale of translatedLocales as Locale[]) {
      for (const item of metadata) {
        expect(messagesByLocale[locale][item.title], `${locale} is missing title: ${item.title}`).toBeTruthy();
        expect(messagesByLocale[locale][item.description], `${locale} is missing description: ${item.description}`).toBeTruthy();
      }
      for (const item of MEDIA_LIST) {
        expect(messagesByLocale[locale][item.label], `${locale} is missing label: ${item.label}`).toBeTruthy();
      }
    }
  });
});
