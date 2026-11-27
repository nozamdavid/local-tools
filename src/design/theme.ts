import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'loconvert-theme';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

// Keep the document updates in sync with public/theme-init.js.
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute('content', theme);
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = themeColor?.dataset[theme];
  if (color) themeColor.content = color;
}

function readSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

/** Dark is the default. Explicit choices persist, including following the system. */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState(readSystemTheme);
  const theme = preference === 'system' ? systemTheme : preference;

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(SYSTEM_THEME_QUERY);
    const update = () => setSystemTheme(query.matches ? 'dark' : 'light');
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    setPreferenceState(next);
  }, []);

  return { preference, theme, setPreference };
}
