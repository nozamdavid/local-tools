import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'loconvert-theme';

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}

function readSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Saved light/dark choices are persisted; the default follows the current OS preference. */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(readSystemTheme);

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
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
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    setPreferenceState(next);
  }, []);

  return { preference, theme: preference === 'system' ? systemTheme : preference, setPreference };
}
