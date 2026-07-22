import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

// localStorage key for the JWT (architecture §6).
export const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Shared axios instance for all API calls. The Vite dev proxy forwards
 * `/api/*` to the NestJS backend on `localhost:3000` so the frontend uses
 * same-origin relative URLs in dev and prod (architecture §6).
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor: attaches `Authorization: Bearer ${token}` from
 * localStorage on every outgoing request (architecture §6). If no token is
 * stored, the header is omitted (the backend's public routes still work).
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Response interceptor: on a 401, clears the stored JWT and redirects to
 * `/login`. This covers token expiry, secret rotation, and any other
 * authentication failure (architecture §6 / VAL-FE-AUTH-010). The redirect
 * uses `window.location` so it works outside of React Router context (e.g.
 * from the axios interceptor, not a component).
 *
 * The AuthProvider (m4-frontend-auth-and-shell) also listens for this and
 * clears its in-memory user state on mount.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      // Only redirect if we're not already on /login or /register to avoid
      // loops (those pages handle 401s inline with form errors).
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

/** Reads the stored JWT, or null if absent. */
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/** Stores the JWT in localStorage. */
export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/** Removes the JWT from localStorage (logout). */
export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
