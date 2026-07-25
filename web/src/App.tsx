import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { PublicOnlyRoute } from './auth/PublicOnlyRoute';
import { AppLayout } from './components/AppLayout';
import { RootRoute } from './components/RootRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { ApodArchive } from './pages/ApodArchive';
import { EonetFeed } from './pages/EonetFeed';
import { NotificationsLog } from './pages/NotificationsLog';
import { Subscribers } from './pages/Subscribers';
import { Skeleton } from './components/Skeleton';

// Lazy-load the /globe route so three.js + react-globe.gl (~595 KB gzip) stay
// out of the initial app bundle (architecture §16.2 / VAL-GLOBE-027). The
// chunk is only fetched on first navigation to /globe.
const EonetGlobe = lazy(() => import('./pages/EonetGlobe'));

/**
 * Placeholder page component for routes not yet implemented. Currently used
 * only for the catch-all 404 route.
 */
function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-deep-space-base px-4 text-center text-star-white">
      <div
        className="card-cosmic mx-auto flex max-w-md flex-col items-center px-6 py-16"
        data-testid="not-found"
      >
        <div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-nebula-purple/40 bg-deep-space-darker/60 text-3xl"
          aria-hidden="true"
        >
          🛰️
        </div>
        <h1 className="font-display text-2xl font-bold text-star-white">
          NASA Sky Tracker
        </h1>
        <p className="mt-2 text-muted">{label}</p>
      </div>
    </div>
  );
}

// Router created with createBrowserRouter per architecture §6.
//
// Route tree (M14 update):
// - `/` is a PUBLIC route rendering the Landing page via `RootRoute`
//   (OUTSIDE `ProtectedRoute`). Authenticated users hitting `/` are
//   redirected to `/dashboard` (VAL-ROUTING-001, VAL-ROUTING-004).
// - Public-only routes (`/login`, `/register`) redirect to `/dashboard` if
//   a session already exists (VAL-FE-AUTH-008 / VAL-ROUTING-006).
// - All app routes are guarded by `ProtectedRoute`, which redirects to
//   `/login` (preserving the originally-requested path) when there is no
//   session (VAL-FE-AUTH-009 / VAL-ROUTING-002, 005). The shared
//   `AppLayout` (top nav + UserMenu with Logout) wraps the protected
//   subtree (VAL-FE-AUTH-011). The app Home (today's APOD) lives at
//   `/dashboard` (VAL-ROUTING-001).
// - The `*` 404 catch-all is preserved.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRoute />,
  },
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
            path: '/dashboard',
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
            path: '/globe',
            element: (
              <Suspense
                fallback={
                  <div className="py-16">
                    <Skeleton rows={4} />
                  </div>
                }
              >
                <EonetGlobe />
              </Suspense>
            ),
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
