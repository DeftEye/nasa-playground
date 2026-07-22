import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { Register } from './Register';
import { AUTH_TOKEN_KEY } from '../api/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'jwt.token.payload';
const USER = {
  id: 'user-1',
  email: 'newuser@example.com',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const EMAIL = 'newuser@example.com';
const PASSWORD = 'valid-password'; // >= 8 chars

function RegisterTree() {
  return (
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<div>Home page</div>} />
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>
  );
}

/**
 * MSW handlers that record how many times register/login were called so
 * tests can assert that field-level validation prevented the API call.
 */
function makeCounters() {
  const counters = { register: 0, login: 0 };
  function handlers() {
    return [
      http.post('/api/auth/register', () => {
        counters.register += 1;
        return HttpResponse.json(USER, { status: 201 });
      }),
      http.post('/api/auth/login', () => {
        counters.login += 1;
        return HttpResponse.json(
          { accessToken: TOKEN, user: USER },
          { status: 200 },
        );
      }),
    ];
  }
  return { counters, handlers };
}

function registerConflictHandler() {
  return http.post('/api/auth/register', () =>
    HttpResponse.json(
      { message: 'Email already registered' },
      { status: 409 },
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Field-level validation (VAL-FE-AUTH-005, general)
// ---------------------------------------------------------------------------

describe('Register field-level validation', () => {
  it('rejects empty fields with field-level errors and no API call', async () => {
    const user = userEvent.setup();
    const { counters, handlers } = makeCounters();
    const { server } = await import('../test/server');
    server.use(...handlers());

    renderWithProviders(<RegisterTree />, {
      routerProps: { initialEntries: ['/register'] },
    });

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(counters.register).toBe(0);
    expect(counters.login).toBe(0);
  });

  it('rejects invalid email format with no API call', async () => {
    const user = userEvent.setup();
    const { counters, handlers } = makeCounters();
    const { server } = await import('../test/server');
    server.use(...handlers());

    renderWithProviders(<RegisterTree />, {
      routerProps: { initialEntries: ['/register'] },
    });

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument();
    expect(counters.register).toBe(0);
  });

  it('rejects password < 8 chars with no API call (VAL-FE-AUTH-005)', async () => {
    const user = userEvent.setup();
    const { counters, handlers } = makeCounters();
    const { server } = await import('../test/server');
    server.use(...handlers());

    renderWithProviders(<RegisterTree />, {
      routerProps: { initialEntries: ['/register'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), 'seven77'); // 7 chars
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(counters.register).toBe(0);
    expect(counters.login).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Conflict (VAL-FE-AUTH-006)
// ---------------------------------------------------------------------------

describe('Register conflict (VAL-FE-AUTH-006)', () => {
  it('shows an inline error referencing the conflict on 409', async () => {
    const user = userEvent.setup();
    const { server } = await import('../test/server');
    server.use(registerConflictHandler());

    renderWithProviders(<RegisterTree />, {
      routerProps: { initialEntries: ['/register'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    const err = await screen.findByTestId('register-submit-error');
    expect(err).toHaveTextContent(/already registered/i);
    // No login attempted after a failed register.
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    // Still on the register page.
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Successful register (VAL-FE-AUTH-007)
// ---------------------------------------------------------------------------

describe('Register success (VAL-FE-AUTH-007)', () => {
  it('POSTs register then login, stores JWT, and redirects to /', async () => {
    const user = userEvent.setup();
    const { counters, handlers } = makeCounters();
    const { server } = await import('../test/server');
    server.use(...handlers());

    renderWithProviders(<RegisterTree />, {
      routerProps: { initialEntries: ['/register'] },
    });

    await user.type(screen.getByLabelText(/email/i), EMAIL);
    await user.type(screen.getByLabelText(/password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // Redirected to /.
    await waitFor(() => {
      expect(screen.getByText('Home page')).toBeInTheDocument();
    });
    // Both register and login were called exactly once.
    expect(counters.register).toBe(1);
    expect(counters.login).toBe(1);
    // JWT persisted.
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(TOKEN);
  });
});
