import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Landing page — public space-themed marketing page
 * (architecture §6 / VAL-LANDING-001..005, VAL-ROUTING-001, 004).
 *
 * Rendered OUTSIDE `ProtectedRoute` at `/` via the `RootRoute` wrapper in
 * `App.tsx`. Unauthenticated visitors see this page; authenticated visitors
 * are redirected to `/dashboard` by `RootRoute` before this component mounts.
 *
 * Sections:
 *  (a) HERO — cosmic art using `/landing-hero.jpg` layered OVER a CSS cosmic
 *      gradient + starfield fallback. The image is referenced via a CSS
 *      `background-image` (never imported through the bundler) so a missing
 *      `web/public/landing-hero.jpg` never breaks the build or tests, and the
 *      hero is never blank/broken. Includes the product name, a tagline about
 *      exploring the cosmos and tracking Earth's natural events, and two CTAs
 *      (react-router `Link`): primary "Sign in" -> `/login` and
 *      "Create account" -> `/register`.
 *  (b) FEATURE HIGHLIGHTS — three cards conveying the daily Astronomy
 *      Picture of the Day (APOD), EONET natural-event tracking, and the
 *      interactive 3D globe.
 *  (c) FOOTER — product name, short attribution to NASA APOD/EONET data,
 *      and links.
 *
 * All styling uses the cosmic tokens/primitives from m14-cosmic-theme-foundation
 * (`web/src/index.css`): `bg-deep-space-*`, `text-star-white`, `text-muted`,
 * `text-nebula-purple*`, `card-cosmic`, `btn-primary`, `btn-secondary`, etc.
 */
export function Landing() {
  return (
    <div className="flex min-h-screen flex-col text-star-white">
      {/* ====================================================================
       * Top bar — public theme toggle (M17 / VAL-THEME-011).
       * --------------------------------------------------------------------
       * A thin top strip so logged-out visitors can switch dark/light
       * before signing in. Kept separate from the hero so the hero art,
       * copy, CTAs, and testids are undisturbed.
       * ================================================================= */}
      <div className="flex items-center justify-end px-4 py-2">
        <ThemeToggle />
      </div>

      {/* ====================================================================
       * (a) HERO
       * --------------------------------------------------------------------
       * The hero element stacks two layers:
       *   1. A CSS cosmic gradient + starfield fallback (always rendered via
       *      `background-color` + layered `radial-gradient` pinpoints,
       *      inherited from `body` plus this section's own fallback below).
       *   2. The optional `/landing-hero.jpg` image layered on top via a
       *      `linear-gradient` + `url('/landing-hero.jpg')` background-image.
       *
       * The image is referenced by URL (served from `web/public/`), NEVER
       * imported through the bundler, so an absent asset does not fail the
       * build or tests. When the file is missing the browser simply drops
       * that layer and the gradient/starfield fallback remains — the hero is
       * never blank or broken (VAL-LANDING-005).
       * ================================================================= */}
      <section
        className="relative flex min-h-[78vh] flex-col items-center justify-center px-4 text-center"
        style={{
          // Cosmic fallback base (always present) — deep-space vertical
          // gradient + a subtle starfield of static radial-gradient
          // pinpoints. This reads even if /landing-hero.jpg is absent.
          backgroundColor: 'var(--color-deep-space-base)',
          backgroundImage: [
            // Starfield pinpoints (fallback layer). Theme-aware: dark mode
            // shows faint white stars on deep-space; cosmic-light shows
            // toned-down lavender/indigo pinpoints on the daytime sky
            // (M17 light-theme audit — previously hardcoded white rgba that
            // was invisible on the light background).
            'radial-gradient(1.5px 1.5px at 18% 22%, var(--starfield-1) 50%, transparent 51%)',
            'radial-gradient(1px 1px at 32% 68%, var(--starfield-2) 50%, transparent 51%)',
            'radial-gradient(1.5px 1.5px at 51% 38%, var(--starfield-3) 50%, transparent 51%)',
            'radial-gradient(1px 1px at 67% 14%, var(--starfield-4) 50%, transparent 51%)',
            'radial-gradient(1.5px 1.5px at 79% 62%, var(--starfield-5) 50%, transparent 51%)',
            'radial-gradient(1px 1px at 88% 84%, var(--starfield-6) 50%, transparent 51%)',
            'radial-gradient(1px 1px at 24% 88%, var(--starfield-7) 50%, transparent 51%)',
            // Cosmic vertical gradient (fallback layer).
            'linear-gradient(180deg, var(--color-deep-space-darker) 0%, var(--color-deep-space-base) 40%, var(--color-deep-space-lighter) 70%, var(--color-deep-space-darker) 100%)',
            // Optional hero image (top layer), layered under a theme-aware
            // overlay so the headline remains legible. The overlay is dark
            // in dark mode (white headline on dark) and light in
            // cosmic-light (dark-ink headline on light) — see the
            // `--hero-overlay-*` vars in index.css (M17 light-theme audit:
            // previously a hardcoded dark rgba that made the dark-ink
            // headline low-contrast in light mode). If the file is absent
            // the browser ignores this layer and the fallbacks above
            // remain. The url() is never bundler-imported.
            'linear-gradient(180deg, var(--hero-overlay-top) 0%, var(--hero-overlay-mid) 60%, var(--hero-overlay-bottom) 100%), url(\'/landing-hero.jpg\')',
          ].join(', '),
          backgroundSize: 'cover, cover, cover, cover, cover, cover, cover, cover, cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'scroll',
        }}
        data-testid="landing-hero"
      >
        <div className="max-w-3xl px-2">
          {/* Product name / logo */}
          <p className="mb-3 font-display text-sm font-semibold uppercase tracking-[0.25em] text-nebula-purple-soft">
            NASA Sky Tracker
          </p>

          <h1 className="font-display text-4xl font-bold tracking-tight text-star-white sm:text-5xl md:text-6xl">
            Explore the cosmos.
            <br />
            <span className="text-nebula-purple-soft">Track Earth&apos;s</span>{' '}
            <span className="text-coral">natural events.</span>
          </h1>

          {/* Tagline */}
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted sm:text-xl">
            A single cosmic dashboard for the daily Astronomy Picture of the
            Day, NASA EONET wildfire and storm tracking, and an interactive 3D
            globe of Earth&apos;s fire and weather — all in one place.
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="btn-primary w-full sm:w-auto"
              data-testid="landing-cta-signin"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="btn-secondary w-full sm:w-auto"
              data-testid="landing-cta-register"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>

      {/* ====================================================================
       * (b) FEATURE HIGHLIGHTS
       * --------------------------------------------------------------------
       * Three cards conveying the daily APOD, EONET natural-event tracking,
       * and the interactive 3D globe. Each carries its required data-testid.
       * ================================================================= */}
      <section
        aria-label="Feature highlights"
        className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20"
      >
        <h2 className="section-heading mb-10 text-center text-2xl sm:text-3xl">
          Three windows into the universe
        </h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* APOD */}
          <article
            className="card-cosmic flex flex-col p-6"
            data-testid="landing-feature-apod"
          >
            <div
              aria-hidden
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-full text-xl"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-nebula-indigo), var(--color-nebula-purple))',
                color: 'var(--color-star-white)',
              }}
            >
              ✦
            </div>
            <h3 className="font-display text-xl font-semibold text-star-white">
              Astronomy Picture of the Day
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Each day NASA selects a breathtaking image of our universe.
              Browse the archive, replay past wonders, and never miss a new
              APOD — including embedded videos when NASA publishes them.
            </p>
          </article>

          {/* EONET */}
          <article
            className="card-cosmic flex flex-col p-6"
            data-testid="landing-feature-eonet"
          >
            <div
              aria-hidden
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-full text-xl"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-coral), var(--color-dune))',
                color: 'var(--color-deep-space-darker)',
              }}
            >
              🔥
            </div>
            <h3 className="font-display text-xl font-semibold text-star-white">
              EONET natural-event tracking
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              NASA&apos;s EONET feed tracks wildfires, severe storms,
              volcanoes, and more across the planet. Filter by category and
              status, then get Discord notifications the moment something
              noteworthy happens.
            </p>
          </article>

          {/* 3D Globe */}
          <article
            className="card-cosmic flex flex-col p-6"
            data-testid="landing-feature-globe"
          >
            <div
              aria-hidden
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-full text-xl"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-nebula-purple-soft), var(--color-nebula-indigo))',
                color: 'var(--color-star-white)',
              }}
            >
              🌍
            </div>
            <h3 className="font-display text-xl font-semibold text-star-white">
              Interactive 3D globe
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Spin a real-time 3D Earth and see where every event is
              happening. Click any country to surface the EONET events that
              occurred there in the last 30 days.
            </p>
          </article>
        </div>
      </section>

      {/* ====================================================================
       * (c) FOOTER
       * --------------------------------------------------------------------
       * Product name, short attribution to NASA APOD/EONET data, and links.
       * ================================================================= */}
      <footer
        className="mt-auto border-t border-nebula-purple/20 bg-deep-space-darker/70"
        data-testid="landing-footer"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row">
          <p className="font-display text-base font-semibold text-star-white">
            NASA Sky Tracker
          </p>
          <p className="text-center sm:text-right">
            Data &amp; imagery courtesy of{' '}
            <a
              href="https://apod.nasa.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-nebula-purple-soft hover:text-star-white transition-colors"
            >
              NASA APOD
            </a>{' '}
            &amp;{' '}
            <a
              href="https://eonet.gsfc.nasa.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-nebula-purple-soft hover:text-star-white transition-colors"
            >
              NASA EONET
            </a>
            . Built for exploration and education.
          </p>
          <nav className="flex items-center gap-4">
            <Link
              to="/login"
              className="hover:text-star-white transition-colors"
              data-testid="landing-footer-signin"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="hover:text-star-white transition-colors"
              data-testid="landing-footer-register"
            >
              Create account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
