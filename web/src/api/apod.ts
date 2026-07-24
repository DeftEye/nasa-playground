import { apiClient } from './client';
import type {
  ApodEntry,
  ApodBackfillResult,
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

/**
 * Backfill the last `days` (default 30, max 30) consecutive dated APOD rows
 * via the JWT-guarded `POST /api/nasa/triggers/backfill-apod?days=` endpoint
 * (VAL-PRODFIX-004 / VAL-PRODFIX-007 / VAL-PRODFIX2-004). Idempotent: a
 * re-run upserts each date (no duplicates), only refreshing `fetched_at`.
 *
 * Returns the partial-success summary `{ requestedDays, saved, failed }`
 * (VAL-PRODFIX2-005): every date that succeeds is in `saved`, each failure
 * is reported in `failed` with a reason. A single unavailable date no
 * longer aborts the loop or surfaces a 500 — the UI reads `saved`/`failed`
 * counts to surface a partial message and refetch the archive whenever
 * `saved.length > 0`.
 */
export async function triggerApodBackfill(
  days: number = 30,
): Promise<ApodBackfillResult> {
  const { data } = await apiClient.post<ApodBackfillResult>(
    '/nasa/triggers/backfill-apod',
    undefined,
    { params: { days } },
  );
  return data;
}
