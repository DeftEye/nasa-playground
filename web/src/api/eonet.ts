import { apiClient } from './client';
import type {
  EonetCategory,
  EonetEventListParams,
  EonetEventListResponse,
  EonetMapParams,
  EonetMapResponse,
} from '../types';

/**
 * EONET API wrappers. All calls go through the shared `apiClient` (axios)
 * which attaches the `Authorization` header and handles 401 globally
 * (architecture §6).
 *
 * Endpoints (backend `EonetController`, global `/api` prefix):
 * - GET /api/nasa/eonet/categories
 *     → 200 EonetCategory[] (array, not wrapped — see EonetController)
 * - GET /api/nasa/eonet/events?category&status&page&limit
 *     → 200 EonetEventListResponse { data, total, page, limit }
 *     (defaults: page=1, limit=50, max limit=100; `category` + `status`
 *     applied as an intersection — VAL-EONET-002)
 */

/** Fetch all seeded EONET categories (ordered by id ASC). */
export async function fetchEonetCategories(): Promise<EonetCategory[]> {
  const { data } = await apiClient.get<EonetCategory[]>(
    '/nasa/eonet/categories',
  );
  return data;
}

/** Fetch a paginated, optionally filtered page of EONET events. */
export async function fetchEonetEvents(
  params: EonetEventListParams = {},
): Promise<EonetEventListResponse> {
  const { data } = await apiClient.get<EonetEventListResponse>(
    '/nasa/eonet/events',
    {
      params: {
        category: params.category,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    },
  );
  return data;
}

/**
 * Fetch map-ready EONET events with normalized `{lat, lng}` and joined
 * categories (architecture §16.1 / VAL-MAP-001..025). The map endpoint is
 * the ONLY data source for plotted globe points (VAL-GLOBE-026); the legacy
 * `/events` list endpoint is not called on `/globe`.
 *
 * Query params (all optional):
 * - `days` (7|14|30, default 30) — date window.
 * - `category` (slug) — intersection filter.
 * - `status` (`open`|`closed`) — intersection filter.
 *
 * Returns a bare `{window, events}` envelope (NOT the paginated list).
 */
export async function fetchEonetMap(
  params: EonetMapParams = {},
): Promise<EonetMapResponse> {
  const { data } = await apiClient.get<EonetMapResponse>(
    '/nasa/eonet/events/map',
    {
      params: {
        days: params.days,
        category: params.category,
        status: params.status,
      },
    },
  );
  return data;
}
