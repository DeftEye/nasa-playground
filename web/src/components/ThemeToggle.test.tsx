import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ThemeToggle } from './ThemeToggle';
import { THEME_STORAGE_KEY } from '../theme/resolveTheme';

/**
 * ThemeToggle component tests (M17 — VAL-THEME-009).
 *
 * Covers the toggle contract:
 *  - renders with `data-testid="theme-toggle"` and an accessible `aria-label`
 *  - the `aria-label` reflects the ACTION (Switch to <other> mode), not the
 *    current state
 *  - clicking the toggle flips the theme: `document.documentElement`
 *    `data-theme` changes AND the choice persists to `localStorage.theme`
 *
 * jsdom does NOT implement `matchMedia`; the tests seed `localStorage.theme`
 * directly to control the initial theme (the documented resolution order:
 * stored value wins over `matchMedia`).
 */

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
}

function installMatchMedia(matches: boolean) {
  window.matchMedia = vi
    .fn()
    .mockImplementation(
      (query: string): MockMediaQueryList => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
}

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // Install a neutral matchMedia (light) so resolution falls through to
  // the seeded localStorage value where tests set one.
  installMatchMedia(false);
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // @ts-expect-error — cleanup of test-installed mock.
  delete window.matchMedia;
});

describe('ThemeToggle (VAL-THEME-009)', () => {
  it('renders with data-testid="theme-toggle" and an accessible aria-label', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderWithTheme(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle.tagName).toBe('BUTTON');
    // aria-label is present and non-empty.
    expect(toggle).toHaveAttribute('aria-label');
    expect(toggle.getAttribute('aria-label')!.length).toBeGreaterThan(0);
  });

  it('aria-label reflects the action: "Switch to light mode" when currently dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderWithTheme(<ThemeToggle />);

    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName(
      'Switch to light mode',
    );
  });

  it('aria-label reflects the action: "Switch to dark mode" when currently light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderWithTheme(<ThemeToggle />);

    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName(
      'Switch to dark mode',
    );
  });

  it('clicking the toggle flips data-theme on document.documentElement and persists to localStorage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderWithTheme(<ThemeToggle />);

    // Initial state: dark.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const toggle = screen.getByTestId('theme-toggle');
    fireEvent.click(toggle);

    // Flipped to light and persisted.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    // The label now reflects the new action (switch back to dark).
    expect(toggle).toHaveAccessibleName('Switch to dark mode');

    // Click again — flips back to dark.
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(toggle).toHaveAccessibleName('Switch to light mode');
  });

  it('the sun/moon affordance is aria-hidden so the aria-label is the sole accessible name', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderWithTheme(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    // The only child is the SVG affordance, which is aria-hidden.
    const svg = toggle.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
