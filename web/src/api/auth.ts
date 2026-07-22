import { apiClient } from './client';
import type {
  LoginPayload,
  LoginResult,
  PublicUser,
  RegisterPayload,
} from '../types';

/**
 * Auth API wrappers. All calls go through the shared `apiClient` (axios)
 * which attaches the `Authorization` header and handles 401 globally
 * (architecture §6 / VAL-FE-AUTH-010).
 *
 * Endpoints (backend `AuthController`, global `/api` prefix):
 * - POST /api/auth/register  → 201 PublicUser (no token; FE auto-logs in)
 * - POST /api/auth/login     → 200 { accessToken, user }
 * - GET  /api/auth/me        → 200 PublicUser (JWT-guarded)
 */

/** Register a new user. Returns the public user shape (no accessToken). */
export async function registerUser(
  payload: RegisterPayload,
): Promise<PublicUser> {
  const { data } = await apiClient.post<PublicUser>('/auth/register', payload);
  return data;
}

/** Log in with email + password. Returns the JWT + public user. */
export async function loginUser(
  payload: LoginPayload,
): Promise<LoginResult> {
  const { data } = await apiClient.post<LoginResult>('/auth/login', payload);
  return data;
}

/** Fetch the current user from `GET /api/auth/me` (JWT-guarded). */
export async function fetchCurrentUser(): Promise<PublicUser> {
  const { data } = await apiClient.get<PublicUser>('/auth/me');
  return data;
}
