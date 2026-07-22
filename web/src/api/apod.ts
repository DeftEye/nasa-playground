import { apiClient } from './client';
import type {
  ApodEntry,
  ApodListParams,
  ApodListResponse,
} from '../types';

/**
 * APOD API wrappers. All calls go through the shared `apiClient` (axios)
 * which attaches the `Authorization` header and handles 401 globally
 * (architecture §6).
 *
 * Endpoints (backend `ApodController` / `ApodTriggerController`, global
 * `/api` prefix):
 * - GET  /api/nasa/apod/today           → 200 ApodEntry (fetch-on-miss)
 * - GET  /api/nasa/apod?page&limit      → 200 ApodListResponse
 * - POST /api/nasa/triggers/fetch-apod  → 200 ApodEntry (JWT-guarded write)
 */

/** Fetch today's APOD row (the backend fetches from NASA on miss). */
export async function fetchTodayApod(): Promise<ApodEntry> {
  const { data } = await apiClient.get<ApodEntry>('/nasa/apod/today');
  return data;
}

/** Fetch a paginated page of the APOD archive (ordered by date DESC). */
export async function fetchApodArchive(
  params: ApodListParams = {},
): Promise<ApodListResponse> {
  const { data } = await apiClient.get<ApodListResponse>('/nasa/apod', {
    params: {
      page: params.page,
      limit: params.limit,
      from: params.from,
      to: params.to,
    },
  });
  return data;
}

/** Manually trigger an APOD fetch for the optional date (default: today). */
export async function triggerApodFetch(
  date?: string,
): Promise<ApodEntry> {
  const { data } = await apiClient.post<ApodEntry>(
    '/nasa/triggers/fetch-apod',
    undefined,
    { params: date ? { date } : undefined },
  );
  return data;
}
