import { Link, Outlet } from 'react-router-dom';
import { UserMenu } from './UserMenu';

/**
 * AppLayout — the shell for all authenticated pages.
 *
 * Renders a top navigation bar with the app title and the top-right
 * `UserMenu` (which contains the Logout button — VAL-FE-AUTH-011).
 * Protected page content renders via `<Outlet />` inside the main region.
 *
 * The layout is rendered as the element of a protected parent route
 * (guarded by `ProtectedRoute`), so it only mounts when `user` is present.
 */
export function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            to="/"
            className="text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            NASA Sky Tracker
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/apod/archive"
              className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Archive
            </Link>
            <Link
              to="/eonet"
              className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              EONET
            </Link>
            <Link
              to="/notifications"
              className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Notifications
            </Link>
            <Link
              to="/subscribers"
              className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Subscribers
            </Link>
            <UserMenu />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
