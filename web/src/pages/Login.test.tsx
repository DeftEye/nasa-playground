import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { Login } from './Login';
import { AUTH_TOKEN_KEY } from '../api/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'jwt.token.payload';
const USER = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const EMAIL = 'user@example.com';
const PASSWORD = 'correct-password'; // >= 8 chars

function loginSuccessHandler() {
  return http.post('/api/auth/login', async () =>
    HttpResponse.json({ accessToken: TOKEN, user: USER }, { status: 200 }),
  );
}

function loginUnauthorizedHandler() {
  return http.post('/api/auth/login', () =>
    HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 }),
  );
}

function loginCountingHandler(counter: { count: number }) {
  return http.post('/api/auth/login', () => {
    counter.count += 1;
    return HttpResponse.json(
      { accessToken: TOKEN, user: USER },
      { status: 200 },
    );
  });
}

function LoginTree() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/register" element={<div>Register page</div>} />
    </Routes>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Field-level validation (VAL-FE-AUTH-001, 002)
// ---------------------------------------------------------------------------

describe('Login field-level validation', () => {
  it('rejects empty fields with field-level errors and no API call (VAL-FE-AUTH-001)', async () => {
    const user = userEvent.setup();
    const counter = { count: 0 };
    const { server } = await import('../test/server');
    server.use(loginCountingHandler(counter));

    renderWithProviders(<LoginTree />, {
      routerProps: { initialEntries: ['/login'] },
    });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Email is required.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(counter.count).toBe(0);
  });

  it('rejects invalid email format with no API call (VAL-FE-AUTH-002)', async () => {
    const user = userEvent.setup();
    const counter = { count: 0 };
    const { server } = await import('../test/server');
    server.use(loginCountingHandler(counter));

    renderWithProviders(<LoginTree />, {
      routerProps: { initialEntries: ['/login'] },
    });

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument();
    expect(counter.count).toBe(0);
  });

  it('rejects password < 8 chars with no API call', async () => {
    const user = userEvent.setup();
    const counter = { count: 0 };
    const { server } = await import('../test/server');
    server.use(loginCountingHandler(counter));

    renderWithProviders(<LoginTree />, {
      routerProps: { initialEntries: ['/login'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), 'short');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(counter.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wrong password (VAL-FE-AUTH-003)
// ---------------------------------------------------------------------------

describe('Login wrong password (VAL-FE-AUTH-003)', () => {
  it('shows a single inline error on 401', async () => {
    const user = userEvent.setup();
    const { server } = await import('../test/server');
    server.use(loginUnauthorizedHandler());

    renderWithProviders(<LoginTree />, {
      routerProps: { initialEntries: ['/login'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByTestId('login-submit-error'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('login-submit-error')).toHaveTextContent(
      'Invalid email or password.',
    );
    // Exactly one inline error (no toast spam).
    expect(screen.getAllByRole('alert').length).toBe(1);
    // No token stored.
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    // Still on the login page.
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Successful login (VAL-FE-AUTH-004)
// ---------------------------------------------------------------------------

describe('Login success (VAL-FE-AUTH-004)', () => {
  it('stores JWT and redirects to /', async () => {
    const user = userEvent.setup();
    const { server } = await import('../test/server');
    server.use(loginSuccessHandler());

    renderWithProviders(<LoginTree />, {
      routerProps: { initialEntries: ['/login'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Redirected to /.
    await waitFor(() => {
      expect(screen.getByText('Home page')).toBeInTheDocument();
    });
    // Token persisted to localStorage.
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(TOKEN);
  });

  it('returns to the originally-requested path after login (VAL-FE-AUTH-009)', async () => {
    const user = userEvent.setup();
    const { server } = await import('../test/server');
    server.use(loginSuccessHandler());

    // ProtectedRoute stores the requested location in `location.state.from`.
    // Simulate that by seeding the MemoryRouter entry with state.
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>Home page</div>} />
        <Route path="/eonet" element={<div>EONET page</div>} />
      </Routes>,
      {
        routerProps: {
          initialEntries: [
            {
              pathname: '/login',
              state: { from: { pathname: '/eonet' } },
            },
          ],
          initialIndex: 0,
        },
      },
    );

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Returns to the originally-requested /eonet, not /.
    await waitFor(() => {
      expect(screen.getByText('EONET page')).toBeInTheDocument();
    });
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(TOKEN);
  });
});
