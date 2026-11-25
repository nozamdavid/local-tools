import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../design/theme';
import { useI18n } from '../lib/i18n';

/** Switches directly between light and dark themes. */
export function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  const { t } = useI18n();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Moon : Sun;

  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={() => setPreference(next)}
      title={t('Switch to {theme} theme', { theme: t(next) })}
      aria-label={t('Switch to {theme} theme', { theme: t(next) })}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
