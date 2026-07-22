/**
 * Masked webhook URL form: `/webhooks/.../<last-4>` (architecture §13).
 *
 * Extracts the last path segment's trailing 4 chars and prefixes the canonical
 * redaction shape. Used in `notification_log.payload` and any subscriber-facing
 * surface so the raw Discord webhook URL never appears in logs or API
 * responses (VAL-NOTIF-007 / VAL-CROSS-011).
 */
export function maskWebhookUrl(url: string): string {
  try {
    const trimmed = url.replace(/\/+$/, '');
    const lastSegment = trimmed.split('/').pop() ?? '';
    const last4 = lastSegment.slice(-4);
    return `/webhooks/.../${last4}`;
  } catch {
    return '/webhooks/.../****';
  }
}
