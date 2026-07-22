import { createBrowserRouter } from 'react-router-dom';

// Placeholder page components. The actual page implementations are owned by
// subsequent M4 features (m4-frontend-auth-and-shell, m4-frontend-home-and-
// archive-pages, etc.). The scaffold provides the router shell so `npm run
// dev` renders a working app and deep links resolve.

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          NASA Sky Tracker
        </h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">{label}</p>
      </div>
    </div>
  );
}

// Router created with createBrowserRouter per architecture §6.
// Routes will be filled in by subsequent M4 features.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Placeholder label="Home — today's APOD (coming soon)" />,
  },
  {
    path: '/login',
    element: <Placeholder label="Login (coming soon)" />,
  },
  {
    path: '/register',
    element: <Placeholder label="Register (coming soon)" />,
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
  {
    path: '*',
    element: <Placeholder label="Page not found" />,
  },
]);
