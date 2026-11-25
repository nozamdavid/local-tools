import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../design/theme';
import { useI18n } from '../lib/i18n';
import styles from './ThemeToggle.module.css';

export function ThemeToggle() {
  const { preference, theme, setPreference } = useTheme();
  const { t } = useI18n();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Moon : Sun;
  const followsSystem = preference === 'system';
  const switchLabel = t('Switch to {theme} theme', { theme: t(next) });
  const systemLabel = t('Follow system theme');

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setPreference(next)}
        title={switchLabel}
        aria-label={switchLabel}
      >
        <Icon aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setPreference(followsSystem ? theme : 'system')}
        title={systemLabel}
        aria-label={systemLabel}
        aria-pressed={followsSystem}
      >
        <Monitor aria-hidden="true" />
      </button>
    </div>
  );
}
