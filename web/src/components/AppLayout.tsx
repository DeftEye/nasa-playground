import { Link, Outlet } from 'react-router-dom';
import { UserMenu } from './UserMenu';

/**
 * AppLayout — the shell for all authenticated pages (cosmic redesign, M14+).
 *
 * Renders a cosmic top navigation bar with the app title and the top-right
 * `UserMenu` (which contains the Logout button — VAL-FE-AUTH-011).
 * Protected page content renders via `<Outlet />` inside the main region.
 * A cosmic footer is rendered below the main content.
 *
 * The layout is rendered as the element of a protected parent route
 * (guarded by `ProtectedRoute`), so it only mounts when `user` is present.
 *
 * Restyle note: only classes/wrappers changed for the cosmic theme. Existing
 * link text ("NASA Sky Tracker", "Archive", "EONET", "Globe", "Notifications",
 * "Subscribers") and the UserMenu testids/behaviour are preserved.
 */
export function AppLayout() {
  const navLinkClass =
    'text-sm text-muted hover:text-star-white transition-colors';

  return (
    <div className="flex min-h-screen flex-col bg-deep-space-base text-star-white">
      <header className="border-b border-nebula-purple/25 bg-deep-space-darker/80 backdrop-blur supports-[backdrop-filter]:bg-deep-space-darker/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            to="/dashboard"
            className="font-display text-lg font-bold text-star-white hover:text-nebula-purple-soft transition-colors"
          >
            NASA Sky Tracker
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/apod/archive" className={navLinkClass}>
              Archive
            </Link>
            <Link to="/eonet" className={navLinkClass}>
              EONET
            </Link>
            <Link to="/globe" className={navLinkClass}>
              Globe
            </Link>
            <Link to="/notifications" className={navLinkClass}>
              Notifications
            </Link>
            <Link to="/subscribers" className={navLinkClass}>
              Subscribers
            </Link>
            <UserMenu />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer
        className="border-t border-nebula-purple/20 bg-deep-space-darker/70"
        data-testid="app-footer"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted sm:flex-row">
          <p className="font-display text-star-white">
            NASA Sky Tracker
          </p>
          <p>
            Built with NASA APOD &amp; EONET data. For exploration and
            education.
          </p>
        </div>
      </footer>
    </div>
  );
}
