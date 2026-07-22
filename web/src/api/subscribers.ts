import { apiClient } from './client';
import type {
  CreateSubscriberPayload,
  PublicSubscriber,
  TestNotificationResult,
  UpdateSubscriberPayload,
} from '../types';

/**
 * Subscribers API wrappers. All calls go through the shared `apiClient`
 * (axios) which attaches the `Authorization` header and handles 401 globally
 * (architecture §6).
 *
 * Endpoints (backend `SubscribersController`, global `/api` prefix):
 * - GET /api/subscribers
 *     → 200 PublicSubscriber[] (array, ordered `createdAt ASC` by the
 *     backend). The raw `discordWebhookUrl` is never present; a
 *     `maskedWebhookUrl` (`/webhooks/.../<last-4>`) is included so the FE
 *     can display a masked indicator per row (VAL-FE-SUB-004 /
 *     VAL-CROSS-011).
 * - POST /api/subscribers
 *     → 201 PublicSubscriber (no raw webhook URL echoed — VAL-SUB-001).
 * - PATCH /api/subscribers/:id
 *     → 200 PublicSubscriber. `eonetCategorySlugs` omitted → unchanged;
 *     `null` → 400; array → atomic M2M replacement (VAL-SUB-005/006/012/013).
 * - DELETE /api/subscribers/:id → 204 (VAL-SUB-008).
 * - POST /api/subscribers/:id/test-notification
 *     → 200 { id, status }. Ignores `enabled` (VAL-SUB-010/014). HTTP is 2xx
 *     even when delivery failed; the outcome is in `status` so the FE can
 *     show an inline success/failure indicator (VAL-FE-SUB-007/009).
 */

/** Fetch the requesting user's subscribers (scoped to their account). */
export async function fetchSubscribers(): Promise<PublicSubscriber[]> {
  const { data } = await apiClient.get<PublicSubscriber[]>('/subscribers');
  return data;
}

/** Create a subscriber owned by the authenticated user. */
export async function createSubscriber(
  payload: CreateSubscriberPayload,
): Promise<PublicSubscriber> {
  const { data } = await apiClient.post<PublicSubscriber>(
    '/subscribers',
    payload,
  );
  return data;
}

/** Update a subscriber (atomic M2M category replacement when slugs given). */
export async function updateSubscriber(
  id: string,
  payload: UpdateSubscriberPayload,
): Promise<PublicSubscriber> {
  const { data } = await apiClient.patch<PublicSubscriber>(
    `/subscribers/${id}`,
    payload,
  );
  return data;
}

/** Delete a subscriber (cascades to its M2M + notification_log rows). */
export async function deleteSubscriber(id: string): Promise<void> {
  await apiClient.delete(`/subscribers/${id}`);
}

/**
 * Send a test notification through the transport. Returns `{ id, status }`
 * of the created `notification_log` row. The HTTP response is always 2xx;
 * a delivery failure is reflected in `status='failed'` (VAL-FE-SUB-009).
 */
export async function sendTestNotification(
  id: string,
): Promise<TestNotificationResult> {
  const { data } = await apiClient.post<TestNotificationResult>(
    `/subscribers/${id}/test-notification`,
  );
  return data;
}
