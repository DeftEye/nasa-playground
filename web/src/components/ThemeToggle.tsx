import { useTheme } from '../theme/ThemeContext';

/**
 * ThemeToggle — accessible dark/light theme switch (M17 / VAL-THEME-009).
 *
 * Renders a single button that flips the active theme via `useTheme()`'s
 * `toggleTheme()`. The provider persists the choice to `localStorage.theme`
 * and reflects it on `document.documentElement` (`data-theme`), so the
 * toggle is functional in every surface that lives inside `ThemeProvider`
 * (the authenticated `AppLayout` header AND the public Landing / Login /
 * Register pages).
 *
 * Accessibility:
 *  - `data-testid="theme-toggle"` for the test suite + validators.
 *  - `aria-label` reflects the ACTION the click will perform, not the
 *    current state: "Switch to light mode" when currently dark, and
 *    "Switch to dark mode" when currently light (VAL-THEME-009).
 *  - The sun/moon affordance is `aria-hidden` so screen readers announce
 *    only the action label.
 *
 * Styling uses the theme-aware `.btn-ghost` primitive (its hover wash flips
 * via `--surface-btn-ghost-hover`) plus cosmic color tokens, so the button
 * looks correct in BOTH themes.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === 'dark';
  const nextTheme = isDark ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      data-testid="theme-toggle"
      aria-label={label}
      title={label}
      className="btn-ghost !px-2 !py-2 rounded-full"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/**
 * Sun affordance — shown in dark mode (clicking switches to light). Inline
 * SVG keeps the icon theme-aware via `currentColor` and avoids an extra
 * asset/bundle dependency. `aria-hidden` so the button's `aria-label` is
 * the sole accessible name.
 */
function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/**
 * Moon affordance — shown in light mode (clicking switches to dark).
 */
function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
