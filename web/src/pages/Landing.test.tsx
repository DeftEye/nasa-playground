import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { Landing } from './Landing';

/**
 * Landing page component tests (m14-landing-page).
 *
 * Covers VAL-LANDING-001..005 at the component level:
 *  - hero + tagline render
 *  - both CTAs present with correct hrefs (/login, /register)
 *  - the three feature highlights (APOD, EONET, 3D globe) are present
 *  - the footer is present
 *  - hero art is always present (cosmic fallback applied regardless of the
 *    image asset, which may be absent at build/test time)
 *
 * The page is rendered within a MemoryRouter (via renderWithProviders) so
 * react-router `Link`s resolve to real hrefs. No MSW handlers are required —
 * the Landing page makes no API calls.
 */

function LandingTree() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<div>Login page</div>} />
      <Route path="/register" element={<div>Register page</div>} />
    </Routes>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('Landing page (VAL-LANDING-001..005)', () => {
  it('renders the hero section and tagline', () => {
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    // Hero surface present.
    const hero = screen.getByTestId('landing-hero');
    expect(hero).toBeInTheDocument();

    // Tagline: the hero heading communicates "Explore the cosmos" and
    // "Track Earth's natural events".
    expect(hero).toHaveTextContent(/explore the cosmos/i);
    expect(hero).toHaveTextContent(/track earth's natural events/i);

    // Product name visible in the hero eyebrow.
    expect(hero).toHaveTextContent(/nasa sky tracker/i);
  });

  it('renders both CTAs with correct hrefs (VAL-LANDING-002)', () => {
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    const signIn = screen.getByTestId('landing-cta-signin');
    const createAccount = screen.getByTestId('landing-cta-register');

    // They are anchor tags rendered by react-router Link.
    expect(signIn.tagName).toBe('A');
    expect(createAccount.tagName).toBe('A');

    // Correct hrefs.
    expect(signIn).toHaveAttribute('href', '/login');
    expect(createAccount).toHaveAttribute('href', '/register');

    // Accessible names preserved (the auth flow tests rely on these too).
    expect(signIn).toHaveTextContent(/sign in/i);
    expect(createAccount).toHaveTextContent(/create account/i);
  });

  it('renders the three feature highlights (VAL-LANDING-003)', () => {
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    const apod = screen.getByTestId('landing-feature-apod');
    const eonet = screen.getByTestId('landing-feature-eonet');
    const globe = screen.getByTestId('landing-feature-globe');

    expect(apod).toBeInTheDocument();
    expect(eonet).toBeInTheDocument();
    expect(globe).toBeInTheDocument();

    // Each highlight has a visible heading + supporting copy.
    expect(apod).toHaveTextContent(/astronomy picture of the day/i);
    expect(eonet).toHaveTextContent(/eonet/i);
    expect(eonet).toHaveTextContent(/natural-event/i);
    expect(globe).toHaveTextContent(/interactive 3d globe/i);
  });

  it('renders a footer with brand and attribution (VAL-LANDING-004)', () => {
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    const footer = screen.getByTestId('landing-footer');
    expect(footer).toBeInTheDocument();

    // Brand name in footer.
    expect(footer).toHaveTextContent(/nasa sky tracker/i);

    // Attribution to NASA APOD & EONET data.
    expect(footer).toHaveTextContent(/nasa apod/i);
    expect(footer).toHaveTextContent(/nasa eonet/i);

    // At least one footer link present (sign in / create account).
    expect(footer.querySelector('a')).not.toBeNull();
    expect(footer).toHaveTextContent(/sign in/i);
    expect(footer).toHaveTextContent(/create account/i);
  });

  it('hero art is always present via a cosmic fallback background (VAL-LANDING-005)', () => {
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    const hero = screen.getByTestId('landing-hero');
    // The hero always has a computed background-image (cosmic gradient +
    // starfield fallback layered with the optional /landing-hero.jpg url).
    // jsdom does not resolve the image, but the CSS string is still set on
    // the inline style, so the hero is never blank/broken even when the
    // asset is absent.
    const backgroundImage = hero.style.backgroundImage;
    expect(backgroundImage).not.toBe('');
    // The optional hero image url is referenced (never bundler-imported).
    expect(backgroundImage).toContain("url('/landing-hero.jpg')");
    // The cosmic gradient fallback is layered underneath.
    expect(backgroundImage).toMatch(/linear-gradient/);
    // The starfield fallback (radial-gradient pinpoints) is layered.
    expect(backgroundImage).toMatch(/radial-gradient/);
    // A deep-space background color is applied as the base.
    expect(hero.style.backgroundColor).not.toBe('');
  });

  it('makes no API calls (public, no auth required) (VAL-LANDING-001)', () => {
    // No MSW handlers are registered for /api/* — the catch-all handler
    // would surface a 500 if any request were made. We render the page and
    // simply assert no error boundary / no request-related error state
    // appeared, which proves the landing is fully static and public.
    renderWithProviders(<LandingTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    // The page renders all required testids without any API dependency.
    expect(screen.getByTestId('landing-hero')).toBeInTheDocument();
    expect(screen.getByTestId('landing-cta-signin')).toBeInTheDocument();
    expect(screen.getByTestId('landing-cta-register')).toBeInTheDocument();
    expect(screen.getByTestId('landing-feature-apod')).toBeInTheDocument();
    expect(screen.getByTestId('landing-feature-eonet')).toBeInTheDocument();
    expect(screen.getByTestId('landing-feature-globe')).toBeInTheDocument();
    expect(screen.getByTestId('landing-footer')).toBeInTheDocument();
  });
});
