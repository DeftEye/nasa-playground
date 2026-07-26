import type { Theme } from './ThemeContext';

/**
 * `localStorage` key the theme is persisted under. The anti-FOUC inline
 * script in `web/index.html` and `ThemeProvider` both read/write this key,
 * so they MUST stay in sync.
 */
export const THEME_STORAGE_KEY = 'theme';

/**
 * Resolve the initial theme using the M17 contract:
 *
 * 1. A valid stored `localStorage.theme` (`'dark'` | `'light'`) wins.
 * 2. Otherwise `window.matchMedia('(prefers-color-scheme: dark)')` → `'dark'`
 *    if it matches, `'light'` otherwise.
 * 3. Otherwise default to `'dark'` (when `matchMedia` is unavailable).
 *
 * This is the single source of truth for the resolution order; the inline
 * anti-FOUC script in `web/index.html` duplicates the same logic in plain JS
 * (it cannot import this module) so the two paths produce the same result.
 *
 * Guards every read with `try/catch` so SSR / disabled-storage / missing
 * `matchMedia` environments fall through to the documented default rather
 * than throwing.
 */
export function resolveTheme(): Theme {
  try {
    const stored =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(THEME_STORAGE_KEY)
        : null;
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {
    // localStorage unavailable (e.g. private mode / disabled) — fall through.
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql && typeof mql.matches === 'boolean') {
        return mql.matches ? 'dark' : 'light';
      }
    } catch {
      // matchMedia thrown (unsupported query) — fall through to default.
    }
  }

  return 'dark';
}
