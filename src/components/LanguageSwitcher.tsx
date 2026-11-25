import type { ChangeEvent } from 'react';
import { LOCALES, useI18n, type Locale } from '../lib/i18n';
import styles from './LanguageSwitcher.module.css';

const NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  it: 'Italiano',
  de: 'Deutsch',
  pt: 'Português',
  fr: 'Français',
};

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  function changeLanguage(event: ChangeEvent<HTMLSelectElement>) {
    setLocale(event.target.value as Locale);
  }

  return (
    <label className={styles.control}>
      <span className="sr-only">{t('Language')}</span>
      <select className={styles.select} value={locale} onChange={changeLanguage} aria-label={t('Language')}>
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {NATIVE_NAMES[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
