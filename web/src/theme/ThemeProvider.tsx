import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ThemeContext, type Theme, type ThemeContextValue } from './ThemeContext';
import { resolveTheme, THEME_STORAGE_KEY } from './resolveTheme';

/**
 * `ThemeProvider` (architecture §6 / VAL-THEME-008).
 *
 * On mount, resolves the initial theme via `resolveTheme()` (stored
 * `localStorage.theme` → `prefers-color-scheme: dark` matchMedia → default
 * `'dark'`). The anti-FOUC inline script in `web/index.html` already set
 * `data-theme` on <html> before the bundle loaded; this provider re-resolves
 * from the same inputs (so it stays correct even if the script were absent)
 * and keeps `data-theme` + `localStorage.theme` in sync on every change.
 *
 * Applies the resolved theme to `document.documentElement` via `data-theme`,
 * persists changes to `localStorage.theme`, and exposes
 * `{ theme, toggleTheme, setTheme }` through `useTheme()`.
 *
 * Wired as the OUTERMOST provider in `web/src/main.tsx` (above
 * QueryClientProvider / AuthProvider) so every consumer can read the theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initializer runs once on mount; matches the anti-FOUC script's
  // resolution so the in-DOM `data-theme` and React state agree.
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());

  // Apply data-theme to <html> and persist to localStorage.theme whenever
  // the theme changes (and once on mount).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable (private mode / disabled) — keep in-memory
      // state + data-theme; persistence is best-effort.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
