import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AuthContext, type AuthContextValue } from './AuthContext';
import {
  fetchCurrentUser,
  loginUser,
  registerUser,
} from '../api/auth';
import {
  clearAuthToken,
  getAuthToken,
  setAuthToken,
} from '../api/client';
import type { LoginResult, PublicUser } from '../types';

/**
 * AuthProvider (architecture §6 / VAL-FE-AUTH-004, 007, 010, 011).
 *
 * Bootstrap: on mount, reads `localStorage.auth_token` once. If present,
 * validates it via `GET /api/auth/me` and seeds `user`. If the token is
 * absent or rejected (401), `user` is `null`. The axios response interceptor
 * (in `api/client.ts`) handles 401 by clearing the token and redirecting to
 * `/login`; the bootstrap catch below also clears the token so a stale value
 * doesn't linger.
 *
 * `login` / `register` persist the JWT via `setAuthToken` so the axios
 * request interceptor attaches it on subsequent calls. Neither method ever
 * places the token in the URL (VAL-FE-AUTH-012).
 *
 * `logout` clears the token, nulls `user`, and (via the caller) redirects to
 * `/login`. Subsequent protected-route visits stay on `/login` because
 * `user === null` (VAL-FE-AUTH-011).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Bootstrap: validate any stored token once on mount.
  useEffect(() => {
    let cancelled = false;
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchCurrentUser()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
      })
      .catch(() => {
        if (cancelled) return;
        // Token invalid/expired — clear it and treat as logged out. The
        // axios 401 interceptor also clears + redirects; this guards the
        // bootstrap path explicitly.
        clearAuthToken();
        setUser(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const result = await loginUser({ email, password });
      setAuthToken(result.accessToken);
      setUser(result.user);
      return result;
    },
    [],
  );

  const register = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      // Register returns the public user (no token); auto-login to obtain
      // the JWT and persist it (architecture §6 / VAL-FE-AUTH-007).
      await registerUser({ email, password });
      const result = await loginUser({ email, password });
      setAuthToken(result.accessToken);
      setUser(result.user);
      return result;
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
