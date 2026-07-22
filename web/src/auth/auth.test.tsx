import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { stubLocation } from '../test/location-stub';
import { useAuth } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import { PublicOnlyRoute } from './PublicOnlyRoute';
import { AppLayout } from '../components/AppLayout';
import { AUTH_TOKEN_KEY } from '../api/client';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'jwt.token.payload';
const USER = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2025-01-01T00:00:00.000Z',
};

function meHandler() {
  return http.get('/api/auth/me', () =>
    HttpResponse.json(USER, { status: 200 }),
  );
}

function meUnauthorizedHandler() {
  return http.get('/api/auth/me', () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  );
}

// A protected child that records whether it mounted (so we can assert no
// data fetch happened on a logged-out visit — VAL-FE-AUTH-009).
let protectedChildMountCount = 0;
function ProtectedChild() {
  protectedChildMountCount += 1;
  return (
    <div>
      <p>Protected content</p>
      <Link to="/login">Login</Link>
    </div>
  );
}

function AppTree() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<div>Login page</div>} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ProtectedChild />} />
          <Route path="/eonet" element={<ProtectedChild />} />
        </Route>
      </Route>
    </Routes>
  );
}

beforeEach(() => {
  protectedChildMountCount = 0;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// AuthProvider bootstrap
// ---------------------------------------------------------------------------

describe('AuthProvider bootstrap', () => {
  it('resolves to no user when no token is stored', async () => {
    const captured: { current: { user: unknown; isLoading: boolean } | null } = {
      current: null,
    };
    function Probe() {
      const auth = useAuth();
      captured.current = { user: auth.user, isLoading: auth.isLoading };
      return null;
    }
    renderWithProviders(<Probe />);
    // The no-token bootstrap resolves synchronously in the mount effect, so
    // by the time `render` returns `isLoading` is already false. We assert
    // the resolved state: no user, not loading.
    await waitFor(() => {
      expect(captured.current?.isLoading).toBe(false);
    });
    expect(captured.current?.user).toBeNull();
  });

  it('seeds user from GET /auth/me when a token is present', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meHandler());

    const captured: { current: { user: unknown; isLoading: boolean } | null } = {
      current: null,
    };
    function Probe() {
      const auth = useAuth();
      captured.current = { user: auth.user, isLoading: auth.isLoading };
      return null;
    }
    renderWithProviders(<Probe />);

    await waitFor(() => {
      expect(captured.current?.isLoading).toBe(false);
    });
    expect(captured.current?.user).toMatchObject({
      id: USER.id,
      email: USER.email,
    });
  });

  it('clears token and nulls user when stored token is rejected (401)', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meUnauthorizedHandler());

    const captured: { current: { user: unknown; isLoading: boolean } | null } = {
      current: null,
    };
    function Probe() {
      const auth = useAuth();
      captured.current = { user: auth.user, isLoading: auth.isLoading };
      return null;
    }
    renderWithProviders(<Probe />);

    await waitFor(() => {
      expect(captured.current?.isLoading).toBe(false);
    });
    expect(captured.current?.user).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ProtectedRoute
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
  it('redirects to /login when no session and does not mount protected child (VAL-FE-AUTH-009)', async () => {
    // No token → AuthProvider skips the bootstrap call entirely (no /auth/me
    // request), so no MSW handler is needed.
    renderWithProviders(<AppTree />, {
      routerProps: { initialEntries: ['/eonet'], initialIndex: 0 },
    });

    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
    // The protected child must NOT have mounted (no data fetch).
    expect(protectedChildMountCount).toBe(0);
  });

  it('renders protected content when a session exists', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meHandler());

    renderWithProviders(<AppTree />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
    expect(protectedChildMountCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PublicOnlyRoute (VAL-FE-AUTH-008)
// ---------------------------------------------------------------------------

describe('PublicOnlyRoute (VAL-FE-AUTH-008)', () => {
  it('redirects authenticated users from /login to /', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meHandler());

    function Tree() {
      return (
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<div>Login page</div>} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<div>Home</div>} />
            </Route>
          </Route>
        </Routes>
      );
    }
    renderWithProviders(<Tree />, {
      routerProps: { initialEntries: ['/login'], initialIndex: 0 },
    });

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 401 interceptor logout (VAL-FE-AUTH-010)
// ---------------------------------------------------------------------------

describe('axios 401 interceptor (VAL-FE-AUTH-010)', () => {
  it('clears token and redirects to /login on 401 from a protected path', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meUnauthorizedHandler());

    const loc = stubLocation('/eonet');
    try {
      function Probe() {
        const auth = useAuth();
        return (
          <div>
            <span>loading:{String(auth.isLoading)}</span>
            <span>user:{auth.user ? 'yes' : 'no'}</span>
          </div>
        );
      }
      renderWithProviders(<Probe />);

      await waitFor(() => {
        expect(screen.getByText('user:no')).toBeInTheDocument();
      });
      // Token cleared by interceptor.
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      // Interceptor redirected to /login (we were on /eonet).
      await waitFor(() => {
        expect(loc.hrefSet).toHaveBeenCalledWith('/login');
      });
    } finally {
      loc.restore();
    }
  });

  it('does not redirect when 401 occurs on /login (no loop)', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meUnauthorizedHandler());

    const loc = stubLocation('/login');
    try {
      function Probe() {
        const auth = useAuth();
        return <span>user:{auth.user ? 'yes' : 'no'}</span>;
      }
      renderWithProviders(<Probe />);

      await waitFor(() => {
        expect(screen.getByText('user:no')).toBeInTheDocument();
      });
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(loc.hrefSet).not.toHaveBeenCalled();
    } finally {
      loc.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Logout (VAL-FE-AUTH-011)
// ---------------------------------------------------------------------------

describe('logout (VAL-FE-AUTH-011)', () => {
  it('clears token, nulls user, and navigates to /login', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meHandler());

    function LogoutProbe() {
      const { user, logout } = useAuth();
      const navigate = useNavigate();
      if (!user) return <span>logged-out</span>;
      return (
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Logout
        </button>
      );
    }
    renderWithProviders(<LogoutProbe />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(TOKEN);

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(screen.getByText('logged-out')).toBeInTheDocument();
    });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it('subsequent protected-route visit stays on /login after logout', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    server.use(meHandler());

    let triggerLogout: (() => void) | null = null;
    function LogoutProbe() {
      const { user, logout } = useAuth();
      const navigate = useNavigate();
      if (user) {
        triggerLogout = () => {
          logout();
          navigate('/login', { replace: true });
        };
        return <span>authed</span>;
      }
      return <span>logged-out</span>;
    }
    const { unmount: unmountFirst } = renderWithProviders(<LogoutProbe />, {
      routerProps: { initialEntries: ['/'], initialIndex: 0 },
    });

    await waitFor(() => {
      expect(screen.getByText('authed')).toBeInTheDocument();
    });
    act(() => {
      triggerLogout!();
    });
    await waitFor(() => {
      expect(screen.getByText('logged-out')).toBeInTheDocument();
    });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    unmountFirst();

    // Subsequent /eonet visit redirects to /login because no token.
    protectedChildMountCount = 0;
    renderWithProviders(<AppTree />, {
      routerProps: { initialEntries: ['/eonet'], initialIndex: 0 },
    });
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
    expect(protectedChildMountCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Token URL hygiene (VAL-FE-AUTH-012)
// ---------------------------------------------------------------------------

describe('token URL hygiene (VAL-FE-AUTH-012)', () => {
  it('attaches token via Authorization header, never in query or path', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
    const { server } = await import('../test/server');
    let capturedRequest: { url: string; headers: Record<string, string> } | null =
      null;
    server.use(
      http.get('/api/auth/me', ({ request }) => {
        capturedRequest = {
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
        };
        return HttpResponse.json(USER, { status: 200 });
      }),
    );

    function Probe() {
      return <span>probe</span>;
    }
    renderWithProviders(<Probe />);

    await waitFor(() => {
      expect(capturedRequest).not.toBeNull();
    });
    const url = capturedRequest!.url;
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain('auth_token');
    expect(capturedRequest!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
  });
});
