import { apiClient } from './client';
import type {
  EonetCategory,
  EonetEventListParams,
  EonetEventListResponse,
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
