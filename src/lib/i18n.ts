import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'es' | 'it' | 'de' | 'pt' | 'fr';

export const LOCALES: readonly Locale[] = ['en', 'es', 'it', 'de', 'pt', 'fr'];

type TranslationMap = Partial<Record<Locale, Record<string, string>>>;

// Include feature and dynamic-label catalogs in both production and test builds.
const catalogs = import.meta.glob<{ messages: TranslationMap }>('../locales/*.ts', {
  eager: true,
});

export const messagesByLocale: Record<Locale, Record<string, string>> = {
  en: {},
  es: {},
  it: {},
  de: {},
  pt: {},
  fr: {},
};

// Feature catalogs load first; canonical catalog and shared shell wording win
// when a common source phrase also appears in a feature catalog.
const catalogPriority = (path: string) => (path.endsWith('/shell.ts') ? 2 : path.endsWith('/catalog.ts') ? 1 : 0);
const orderedCatalogs = Object.entries(catalogs).sort(([a], [b]) => catalogPriority(a) - catalogPriority(b) || a.localeCompare(b));
for (const [, catalog] of orderedCatalogs) {
  for (const locale of LOCALES) {
    const localeMessages = catalog.messages[locale];
    if (localeMessages) Object.assign(messagesByLocale[locale], localeMessages);
  }
}

const STORAGE_KEY = 'loconvert-locale';
const listeners = new Set<() => void>();

function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value.toLowerCase());
}

function preferredLocale(preferences: readonly string[] = []): Locale | null {
  for (const preference of preferences) {
    const base = preference.trim().toLowerCase().split(/[-_]/, 1)[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** Resolves an explicit saved choice first, then the first supported browser preference. */
export function resolveLocale(savedLocale: string | null | undefined, preferences: readonly string[] = []): Locale {
  if (isLocale(savedLocale)) return savedLocale.toLowerCase() as Locale;
  return preferredLocale(preferences) ?? 'en';
}

function browserPreferences(): string[] {
  if (typeof navigator === 'undefined') return [];
  try {
    return [...(navigator.languages?.length ? navigator.languages : [navigator.language])];
  } catch {
    return [];
  }
}

function readSavedLocale(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let currentLocale = resolveLocale(readSavedLocale(), browserPreferences());

function updateDocumentLanguage(locale: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

updateDocumentLanguage(currentLocale);

function publish(locale: Locale) {
  if (locale === currentLocale) {
    updateDocumentLanguage(locale);
    return;
  }
  currentLocale = locale;
  updateDocumentLanguage(locale);
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) publish(resolveLocale(readSavedLocale(), browserPreferences()));
  });
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (!isLocale(locale)) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory choice when browser storage is unavailable.
  }
  publish(locale);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function translate(sourceEnglish: string, params: Record<string, string | number> = {}): string {
  const catalog = messagesByLocale[currentLocale];
  const translated = Object.hasOwn(catalog, sourceEnglish) ? catalog[sourceEnglish] : sourceEnglish;
  return translated.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : placeholder,
  );
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, setLocale, t: translate };
}
