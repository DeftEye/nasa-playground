import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Skeleton } from './Skeleton';
import { Landing } from '../pages/Landing';

/**
 * RootRoute — the PUBLIC `/` route (architecture §6, M14 update /
 * VAL-ROUTING-001, VAL-ROUTING-004).
 *
 * `/` is no longer the auth-gated app Home; it is the public space-themed
 * landing page rendered OUTSIDE `ProtectedRoute`. This wrapper reads the
 * auth context so an authenticated user visiting `/` is bounced to the app
 * (`/dashboard`) instead of seeing the marketing landing again.
 *
 * - While the AuthProvider is bootstrapping (validating any stored token),
 *   render the same loading skeleton used by `ProtectedRoute` so the
 *   Landing page does not flash to a logged-in user.
 * - Once bootstrap resolves:
 *   - `user` present → redirect. The destination honors a deep-link return
 *     path stored in `location.state.from.pathname` (preserved by
 *     `ProtectedRoute` when it bounces a logged-out user to `/login`,
 *     VAL-ROUTING-005), falling back to `/dashboard` when no return path
 *     is present (VAL-ROUTING-004 — authed visit to `/` with no `from`
 *     still lands on `/dashboard`).
 *   - `user === null` → render `<Landing />` (the public marketing page).
 *
 * The token is never placed in the URL (VAL-FE-AUTH-012).
 */
const PUBLIC_ONLY_PATHS = new Set(['/login', '/register']);

function pickReturnPath(pathname: string | undefined): string {
  if (pathname && !PUBLIC_ONLY_PATHS.has(pathname)) {
    return pathname;
  }
  return '/dashboard';
}

export function RootRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deep-space-base">
        <div className="w-full max-w-md p-8">
          <Skeleton rows={4} />
        </div>
      </div>
    );
  }

  if (user) {
    const fromPath = (location.state as { from?: { pathname: string } } | null)
      ?.from?.pathname;
    return <Navigate to={pickReturnPath(fromPath)} replace />;
  }

  return <Landing />;
}
