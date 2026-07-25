import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { AppLayout } from './AppLayout';

/**
 * Cosmic redesign foundation (M14 — m14-cosmic-theme-foundation).
 *
 * These tests assert the structural pieces the foundation adds to the shared
 * `AppLayout`: a cosmic-themed wrapper class and a newly-added footer with a
 * stable `data-testid`. The cosmic palette tokens, global background, and
 * Space Grotesk heading font live in `web/src/index.css` (Tailwind v4
 * `@theme` + `:root` CSS variables) and are exercised end-to-end by the
 * validator via agent-browser computed-style checks (VAL-THEME-001); here we
 * guard the regressable DOM surface.
 */

function Child() {
  return <p>Protected content</p>;
}

describe('AppLayout cosmic foundation', () => {
  it('renders a footer with data-testid="app-footer"', () => {
    function Tree() {
      return (
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Child />} />
          </Route>
        </Routes>
      );
    }
    renderWithProviders(<Tree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    const footer = screen.getByTestId('app-footer');
    expect(footer).toBeInTheDocument();
    // Footer carries the product brand text.
    expect(footer.textContent).toContain('NASA Sky Tracker');
  });

  it('applies the cosmic wrapper class to the layout root', () => {
    const { container } = renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Child />} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/'], initialIndex: 0 } },
    );

    // The outermost wrapper div carries the cosmic deep-space base class.
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-deep-space-base');
    expect(root.className).toContain('text-star-white');
  });

  it('preserves the brand and nav link text through the restyle', () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Child />} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/'], initialIndex: 0 } },
    );

    // Brand text appears in both the header and the new footer.
    expect(screen.getAllByText('NASA Sky Tracker').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('EONET')).toBeInTheDocument();
    expect(screen.getByText('Globe')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Subscribers')).toBeInTheDocument();
  });
});
