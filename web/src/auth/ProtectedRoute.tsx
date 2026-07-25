import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AuthBootstrapSkeleton } from '../components/ui/AuthBootstrapSkeleton';

/**
 * ProtectedRoute (architecture §6 / VAL-FE-AUTH-009, 011).
 *
 * Guards descendant routes by checking the auth context. While the
 * AuthProvider is bootstrapping (validating any stored token), a loading
 * skeleton is rendered so the protected page component does NOT mount and
 * trigger data fetches before auth is confirmed (VAL-FE-AUTH-009 requires
 * "no EONET fetch observed" on a logged-out visit).
 *
 * Once bootstrap resolves:
 * - `user === null` → redirect to `/login`, preserving the originally-
 *   requested path in `location.state.from` so post-login can return there.
 *   The token is never placed in the URL (VAL-FE-AUTH-012).
 * - `user` present → render the protected subtree via `<Outlet />`.
 *
 * After logout, `user` flips to `null`, so any subsequent protected-route
 * visit redirects back to `/login` (VAL-FE-AUTH-011).
 */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthBootstrapSkeleton />;
  }

  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: location }} />
    );
  }

  return <Outlet />;
}
