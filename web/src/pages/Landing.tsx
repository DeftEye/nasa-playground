import { Link } from 'react-router-dom';

/**
 * Landing page — public space-themed marketing page
 * (architecture §6 / VAL-ROUTING-001, 004).
 *
 * Rendered OUTSIDE `ProtectedRoute` at `/` via the `RootRoute` wrapper in
 * `App.tsx`. Unauthenticated visitors see this page; authenticated visitors
 * are redirected to `/dashboard` by `RootRoute` before this component
 * mounts.
 *
 * This is the M14 routing placeholder: it ships the minimum public surface
 * (hero area + a "Sign in" link to `/login` + a "Create account" link to
 * `/register`) styled with the cosmic tokens. The FULL hero art, feature
 * highlights, and footer are filled in by the next feature
 * (`m14-landing-page`), which extends this same component. Do not over-style
 * here — keep it minimal and on-token.
 *
 * Landing hero asset: `web/public/landing-hero.jpg` is referenced via a CSS
 * `background-image` layered OVER a cosmic gradient/starfield fallback so a
 * missing asset never breaks the build or renders blank.
 */
export function Landing() {
  return (
    <div className="min-h-screen text-star-white">
      {/* Hero area — cosmic gradient/starfield fallback with the optional
       * landing-hero.jpg layered on top. The image is served at
       * /landing-hero.jpg and may be absent; the gradient still reads. */}
      <section
        className="relative flex min-h-[70vh] flex-col items-center justify-center px-4 text-center"
        style={{
          backgroundColor: 'var(--color-deep-space-base)',
          backgroundImage:
            "linear-gradient(180deg, rgba(4,4,12,0.55) 0%, rgba(10,10,26,0.75) 100%), url('/landing-hero.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
        data-testid="landing-hero"
      >
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-star-white sm:text-5xl">
            NASA Sky Tracker
          </h1>
          <p className="mt-4 text-lg text-muted">
            Explore the cosmos daily. APOD, EONET natural events, and a 3D
            globe of Earth's fire and storms — all in one cosmic dashboard.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/login" className="btn-primary w-full sm:w-auto">
              Sign in
            </Link>
            <Link to="/register" className="btn-secondary w-full sm:w-auto">
              Create account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
