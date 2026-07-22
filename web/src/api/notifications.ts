import { apiClient } from './client';
import type {
  NotificationListParams,
  PublicNotification,
} from '../types';

/**
 * Notifications API wrappers. All calls go through the shared `apiClient`
 * (axios) which attaches the `Authorization` header and handles 401 globally
 * (architecture §6).
 *
 * Endpoints (backend `NotificationsController`, global `/api` prefix):
 * - GET /api/notifications?source&status&page&limit
 *     → 200 PublicNotification[] (array, ordered `deliveredAt DESC`
 *     newest-first by the backend — VAL-FE-NOTIF-005). `payload` is included
 *     with the redacted webhook URL (`/webhooks/.../<last-4>`) so the raw
 *     Discord URL never reaches the client (VAL-NOTIF-007 / VAL-FE-NOTIF-004).
 *     Defaults: page=1, limit=20, max limit=100; `?limit=200` → 400.
 */

/** Fetch the requesting user's notification log rows (newest-first). */
export async function fetchNotifications(
  params: NotificationListParams = {},
): Promise<PublicNotification[]> {
  const { data } = await apiClient.get<PublicNotification[]>(
    '/notifications',
    {
      params: {
        source: params.source,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    },
  );
  return data;
}
