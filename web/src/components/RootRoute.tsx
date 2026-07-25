import { Navigate } from 'react-router-dom';
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
 *   - `user` present → `<Navigate to="/dashboard" replace />`.
 *   - `user === null` → render `<Landing />` (the public marketing page).
 *
 * The token is never placed in the URL (VAL-FE-AUTH-012).
 */
export function RootRoute() {
  const { user, isLoading } = useAuth();

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
    return <Navigate to="/dashboard" replace />;
  }

  return <Landing />;
}
