import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { UserMenu } from './UserMenu';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext';
import type { PublicUser } from '../types';

/**
 * Stacking regression test for VAL-THEME-007.
 *
 * jsdom cannot verify true paint order, so this test locks in the class
 * contract that establishes the stacking layer: the open UserMenu dropdown
 * container must carry an explicit z-index class so it paints above the
 * page content (e.g. the APOD hero on /dashboard). The AppLayout <header>
 * z-index contract is covered in cosmic.test.tsx.
 *
 * Logout behaviour, data-testids, aria attributes, and menu text are
 * intentionally NOT exercised here — they are owned by the auth suite
 * (auth.test.tsx). This is a CSS/stacking-only guard.
 */

const USER: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2025-01-01T00:00:00.000Z',
};

function makeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: USER,
    isLoading: false,
    login: vi.fn(async () => ({
      accessToken: 'jwt.token.payload',
      user: USER,
    })) as AuthContextValue['login'],
    register: vi.fn(async () => ({
      accessToken: 'jwt.token.payload',
      user: USER,
    })) as AuthContextValue['register'],
    logout: vi.fn(),
    ...overrides,
  };
}

function renderMenu(authValue: AuthContextValue = makeAuthValue()) {
  function Tree() {
    return (
      <AuthContext.Provider value={authValue}>
        <Routes>
          <Route path="/*" element={<UserMenu />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthContext.Provider>
    );
  }
  return renderWithProviders(<Tree />, {
    routerProps: { initialEntries: ['/'], initialIndex: 0 },
  });
}

describe('UserMenu stacking (VAL-THEME-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the open dropdown container carries an explicit z-index class', () => {
    renderMenu();

    const avatar = screen.getByRole('button', { name: 'User menu' });
    fireEvent.click(avatar);

    const menu = screen.getByRole('menu', { name: 'User menu' });
    expect(menu.className).toMatch(/\bz-50\b/);
    // Position context preserved (absolute positioning still present).
    expect(menu.className).toMatch(/\babsolute\b/);
  });

  it('Logout button remains wired (calls logout and closes the menu)', () => {
    const logoutSpy = vi.fn();
    renderMenu(makeAuthValue({ logout: logoutSpy }));

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    const logoutItem = screen.getByRole('menuitem', { name: 'Logout' });
    fireEvent.click(logoutItem);

    // handleLogout calls logout(), setOpen(false), then navigate('/login').
    // We assert logout was invoked and the menu closed (open state reset)
    // as a proxy that the handler ran end-to-end without throwing. The full
    // /login navigation + localStorage.clear contract is owned by auth.test.tsx.
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('menu', { name: 'User menu' }),
    ).not.toBeInTheDocument();
  });

  it('preserves aria attributes, menu text, and email row', () => {
    renderMenu();

    const avatar = screen.getByRole('button', { name: 'User menu' });
    expect(avatar).toHaveAttribute('aria-haspopup', 'menu');
    expect(avatar).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(avatar);
    expect(avatar).toHaveAttribute('aria-expanded', 'true');

    // Email row + Logout text preserved (VAL-THEME-007 / VAL-FE-AUTH-011).
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument();
  });
});
