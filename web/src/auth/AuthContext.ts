import { createContext, useContext } from 'react';
import type { LoginResult, PublicUser } from '../types';

/**
 * Auth context shape (architecture §6 / VAL-FE-AUTH-*).
 *
 * `isLoading` is true only during the initial bootstrap (reading the stored
 * token and validating it via `GET /auth/me`). Once it flips to false,
 * `user` is either a `PublicUser` (token present + valid) or `null` (no
 * token, or token rejected by the backend).
 *
 * `login` and `register` resolve to the `LoginResult` so callers can read
 * the access token if needed; both also update the in-memory `user` and
 * persist the JWT to localStorage via the shared api client helpers.
 *
 * `logout` clears the stored token, sets `user = null`, and redirects to
 * `/login`. The redirect itself is performed by the caller (typically the
 * `UserMenu`'s Logout button) using React Router so history stays clean
 * (no token ever appears in the URL — VAL-FE-AUTH-012).
 */
export interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

/**
 * Hook to access the auth context. Throws if used outside `AuthProvider`,
 * which makes misuse loud during development and tests.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
