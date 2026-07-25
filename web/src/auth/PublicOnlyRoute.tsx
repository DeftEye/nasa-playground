import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Skeleton } from '../components/Skeleton';

/**
 * PublicOnlyRoute — for `/login` and `/register`.
 *
 * If a valid session already exists, redirect away from the public-only
 * route. The destination honors the deep-link return path stored in
 * `location.state.from.pathname` (preserved by `ProtectedRoute` when it
 * bounces a logged-out user to `/login`), falling back to `/dashboard`
 * when no return path is present (VAL-FE-AUTH-008 / VAL-ROUTING-005,
 * VAL-ROUTING-006).
 *
 * This is the critical fix for VAL-ROUTING-005: previously this wrapper
 * hardcoded `/dashboard`, which raced with `Login.tsx`'s
 * `navigate(from || '/dashboard')` after `AuthProvider.login()` called
 * `setUser()`. Because `setUser` flips `user` non-null synchronously,
 * React re-renders `PublicOnlyRoute` first and its hardcoded
 * `<Navigate to="/dashboard">` overrides the intended return path. By
 * reading the same `from` here, both paths agree and the user lands on
 * the originally-requested route (e.g. `/eonet`).
 *
 * Self-route guard: if `from.pathname` is `/login` or `/register` (would
 * loop back into a public-only route), fall back to `/dashboard`.
 *
 * While the AuthProvider is bootstrapping, render a loading skeleton
 * instead of the form so we don't flash the login form to a logged-in
 * user.
 *
 * No token ever enters the URL (VAL-FE-AUTH-012).
 */
const PUBLIC_ONLY_PATHS = new Set(['/login', '/register']);

function pickReturnPath(pathname: string | undefined): string {
  if (pathname && !PUBLIC_ONLY_PATHS.has(pathname)) {
    return pathname;
  }
  return '/dashboard';
}

export function PublicOnlyRoute() {
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

  return <Outlet />;
}
