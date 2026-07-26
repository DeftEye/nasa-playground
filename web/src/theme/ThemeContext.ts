import { createContext, useContext } from 'react';

/**
 * Theme system (M17 — dual dark + cosmic-light).
 *
 * The active theme is driven by a `data-theme="dark"|"light"` attribute on
 * the <html> element. `ThemeProvider` (in `ThemeProvider.tsx`) resolves the
 * initial theme, applies `data-theme` to `document.documentElement`, and
 * persists the user's choice to `localStorage.theme`. An anti-FOUC inline
 * script in `web/index.html` sets `data-theme` BEFORE the React bundle loads
 * using the same resolution logic, so there is no flash of the wrong theme.
 *
 * Token / primitive flip lives in `web/src/index.css`:
 * - `:root` holds the DARK defaults.
 * - `:root[data-theme='light']` overrides the palette for cosmic-light.
 * - Theme-aware primitives (`.card-cosmic`, `.input-cosmic`, `.btn-secondary`,
 *   `.btn-ghost` hover, `.input-cosmic::placeholder`, body background +
 *   starfield) read `var(--surface-*)` / `--bg-body-*` / `--starfield-*` /
 *   `--placeholder-color` variables that flip under the light selector.
 */

export type Theme = 'dark' | 'light';

export interface ThemeContextValue {
  /** The currently-active theme (`'dark'` | `'light'`). */
  theme: Theme;
  /** Flip the theme: dark → light, light → dark. */
  toggleTheme: () => void;
  /** Set the theme explicitly. Useful for the toggle UI / future controls. */
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

/**
 * Hook to access the theme context. Throws if used outside `ThemeProvider`,
 * which makes misuse loud during development and tests.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
