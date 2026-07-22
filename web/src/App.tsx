import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { PublicOnlyRoute } from './auth/PublicOnlyRoute';
import { AppLayout } from './components/AppLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

/**
 * Placeholder page components for routes owned by subsequent M4 features
 * (Home, Archive, EONET, Notifications, Subscribers). They render inside the
 * authenticated `AppLayout` shell so the top-right user menu (Logout) is
 * visible and protected-route gating works end-to-end today. Each will be
 * replaced by its real implementation in its own feature.
 */
function Placeholder({ label }: { label: string }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
        NASA Sky Tracker
      </h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

// Router created with createBrowserRouter per architecture §6.
//
// Route tree:
// - Public-only routes (`/login`, `/register`) redirect to `/` if a session
//   already exists (VAL-FE-AUTH-008).
// - All other routes are guarded by `ProtectedRoute`, which redirects to
//   `/login` (preserving the originally-requested path) when there is no
//   session (VAL-FE-AUTH-009). The shared `AppLayout` (top nav + UserMenu
//   with Logout) wraps the protected subtree (VAL-FE-AUTH-011).
export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/',
            element: <Placeholder label="Home — today's APOD (coming soon)" />,
          },
          {
            path: '/apod/archive',
            element: <Placeholder label="APOD Archive (coming soon)" />,
          },
          {
            path: '/eonet',
            element: <Placeholder label="EONET Feed (coming soon)" />,
          },
          {
            path: '/notifications',
            element: <Placeholder label="Notifications Log (coming soon)" />,
          },
          {
            path: '/subscribers',
            element: <Placeholder label="Subscribers (coming soon)" />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Placeholder label="Page not found" />,
  },
]);
