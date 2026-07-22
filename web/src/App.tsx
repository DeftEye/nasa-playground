import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { PublicOnlyRoute } from './auth/PublicOnlyRoute';
import { AppLayout } from './components/AppLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { ApodArchive } from './pages/ApodArchive';
import { EonetFeed } from './pages/EonetFeed';
import { NotificationsLog } from './pages/NotificationsLog';
import { Subscribers } from './pages/Subscribers';

/**
 * Placeholder page component for routes not yet implemented. Currently used
 * only for the catch-all 404 route.
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
            element: <Home />,
          },
          {
            path: '/apod/archive',
            element: <ApodArchive />,
          },
          {
            path: '/eonet',
            element: <EonetFeed />,
          },
          {
            path: '/notifications',
            element: <NotificationsLog />,
          },
          {
            path: '/subscribers',
            element: <Subscribers />,
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
