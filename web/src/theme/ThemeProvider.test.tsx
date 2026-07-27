import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { useTheme, type Theme } from './ThemeContext';
import { resolveTheme, THEME_STORAGE_KEY } from './resolveTheme';

/**
 * ThemeProvider tests (M17 — VAL-THEME-008).
 *
 * Covers the resolution contract:
 *   1. default resolves from `matchMedia` when no stored value (dark + light);
 *   2. stored `localStorage.theme` takes precedence over `matchMedia`;
 *   3. toggling updates `document.documentElement` `data-theme` AND persists
 *      to `localStorage.theme`;
 *   4. default falls back to `'dark'` when `matchMedia` is unavailable.
 *
 * jsdom does NOT implement `matchMedia`, so each test installs a controlled
 * mock (or removes it) via `installMatchMedia`. The global setup file
 * (`web/src/test/setup.ts`) clears `localStorage` between tests; we also
 * clear `data-theme` and restore `matchMedia` here for isolation.
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

/**
 * Install a `window.matchMedia` mock that reports the given `matches` value.
 * Pass `null` to delete `window.matchMedia` entirely (simulates an
 * environment where `matchMedia` is unavailable).
 */
function installMatchMedia(matches: boolean | null) {
  if (matches === null) {
    // @ts-expect-error — intentionally removing matchMedia for the test.
    delete window.matchMedia;
    return;
  }
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

function freshDocumentElement() {
  document.documentElement.removeAttribute('data-theme');
}

beforeEach(() => {
  localStorage.clear();
  freshDocumentElement();
});

afterEach(() => {
  // Restore matchMedia so a later test that doesn't call installMatchMedia
  // sees a clean slate (jsdom doesn't provide one by default).
  // @ts-expect-error — cleanup of test-installed mock.
  delete window.matchMedia;
});

describe('ThemeProvider / resolveTheme', () => {
  it('defaults to dark when matchMedia reports prefers-color-scheme: dark and no stored value', () => {
    installMatchMedia(true);
    render(<ThemeProvider>...</ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to light when matchMedia reports prefers-color-scheme: light and no stored value', () => {
    installMatchMedia(false);
    render(<ThemeProvider>...</ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stored localStorage.theme takes precedence over matchMedia', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    // OS prefers dark — stored value must still win.
    installMatchMedia(true);
    render(<ThemeProvider>...</ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stored dark value takes precedence over a light matchMedia result', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    installMatchMedia(false);
    render(<ThemeProvider>...</ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggling updates document.documentElement data-theme AND persists to localStorage', () => {
    installMatchMedia(true);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    // Initial resolved theme is dark (matchMedia dark, no stored value).
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // Toggle back to dark and confirm persistence follows.
    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('setTheme updates data-theme and persists the requested value', () => {
    installMatchMedia(false); // would resolve light
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe('light');

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('falls back to dark when matchMedia is unavailable', () => {
    installMatchMedia(null);
    render(<ThemeProvider>...</ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolveTheme returns dark when matchMedia is unavailable (no React render needed)', () => {
    installMatchMedia(null);
    const theme: Theme = resolveTheme();
    expect(theme).toBe('dark');
  });

  it('resolveTheme returns the stored value even when matchMedia disagrees', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    installMatchMedia(true);
    expect(resolveTheme()).toBe('light');
  });

  it('useTheme throws when used outside a ThemeProvider', () => {
    // Suppress the expected console.error from React/JSDOM for the thrown
    // hook so the test output stays clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      /useTheme must be used within a ThemeProvider/,
    );
    spy.mockRestore();
  });
});
