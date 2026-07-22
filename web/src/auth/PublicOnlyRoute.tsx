import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Skeleton } from '../components/Skeleton';

/**
 * PublicOnlyRoute — for `/login` and `/register`.
 *
 * If a valid session already exists, redirect to `/` so an authenticated
 * user visiting `/login` is bounced to the app (VAL-FE-AUTH-008). While the
 * AuthProvider is bootstrapping, render a loading skeleton instead of the
 * form so we don't flash the login form to a logged-in user.
 *
 * No token ever enters the URL (VAL-FE-AUTH-012).
 */
export function PublicOnlyRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md p-8">
          <Skeleton rows={4} />
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
