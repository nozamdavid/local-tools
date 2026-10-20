import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../design/theme';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const ICONS = { system: Monitor, light: Sun, dark: Moon };
const LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = ICONS[preference];
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={() => setPreference(next)}
      title={`${LABELS[preference]} (switch to ${LABELS[next].toLowerCase()})`}
      aria-label={`${LABELS[preference]}. Switch to ${LABELS[next].toLowerCase()}`}
    >
      <Icon />
    </button>
  );
}
