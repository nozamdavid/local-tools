import { getLocale, type Locale } from './i18n';

const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-ES',
  it: 'it-IT',
  de: 'de-DE',
  pt: 'pt-PT',
  fr: 'fr-FR',
};

export function formatNumber(value: number, maximumFractionDigits = 0, minimumIntegerDigits = 1, minimumFractionDigits = 0): string {
  const fractionDigits = Number.isFinite(maximumFractionDigits) ? Math.max(0, Math.trunc(maximumFractionDigits)) : 0;
  const integerDigits = Number.isFinite(minimumIntegerDigits) ? Math.max(1, Math.trunc(minimumIntegerDigits)) : 1;
  return new Intl.NumberFormat(INTL_LOCALES[getLocale()], {
    useGrouping: false,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: Math.min(fractionDigits, Math.max(0, minimumFractionDigits)),
    minimumIntegerDigits: integerDigits,
  }).format(value);
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const k = 1024;
  const dm = Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  const value = bytes / Math.pow(k, index);
  return `${formatNumber(value, dm)} ${sizes[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return `${formatNumber(0)}:${formatNumber(0, 1, 2, 1)}`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sStr = formatNumber(s, 1, 2, 1);
  if (h > 0) {
    return `${formatNumber(h)}:${formatNumber(m, 0, 2)}:${sStr}`;
  }
  return `${formatNumber(m)}:${sStr}`;
}

export function replaceExt(filename: string, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  return `${base}.${cleanExt}`;
}

export function withSuffix(filename: string, suffix: string, ext?: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const currentExt = dotIdx > 0 ? filename.slice(dotIdx + 1) : '';
  const targetExt = ext !== undefined ? (ext.startsWith('.') ? ext.slice(1) : ext) : currentExt;
  return targetExt ? `${base}${suffix}.${targetExt}` : `${base}${suffix}`;
}
