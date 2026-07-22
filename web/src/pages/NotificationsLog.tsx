import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchNotifications } from '../api/notifications';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type {
  NotificationSource,
  NotificationStatus,
  PublicNotification,
} from '../types';

/**
 * Notifications Log (architecture §6 / VAL-FE-NOTIF-001..007,
 * VAL-FE-ERR-002).
 *
 * Table columns (in this exact order — VAL-FE-NOTIF-001):
 *   deliveredAt | source | subscriberId | referenceId | status
 *
 * - `deliveredAt` is formatted as an ISO-8601 string in the user's *local*
 *   timezone (architecture §6 / VAL-FE-NOTIF-001).
 * - Default sort is newest-first: the backend returns rows ordered by
 *   `deliveredAt DESC`, and the page renders them in that order
 *   (VAL-FE-NOTIF-005).
 * - Both `?source` and `?status` filters are exposed as dropdowns
 *   (VAL-FE-NOTIF-002 / VAL-FE-NOTIF-006). "all" omits the param.
 * - Clicking a row opens a modal that serializes the row's `payload` as JSON.
 *   The payload already carries the redacted webhook URL
 *   (`/webhooks/.../<last-4>`) from the backend, so the raw Discord URL
 *   never appears (VAL-FE-NOTIF-003 / VAL-FE-NOTIF-004).
 *
 * Cross-page UX policy:
 * - Loading skeleton while the query is pending (VAL-FE-NOTIF-007).
 * - Empty state when the user has no notifications.
 * - Inline error + Retry on 5xx / network failure (VAL-FE-ERR-002).
 */

type SourceFilter = NotificationSource | 'all';
type StatusFilter = NotificationStatus | 'all';

const SOURCE_OPTIONS: SourceFilter[] = ['all', 'apod', 'eonet', 'test'];
const STATUS_OPTIONS: StatusFilter[] = ['all', 'sent', 'mocked', 'failed'];

/**
 * Formats a Date as an ISO-8601 string in the user's *local* timezone
 * (e.g. `2025-07-22T12:00:00`). Used for the `deliveredAt` column so the
 * timestamp reflects the viewer's local clock rather than UTC
 * (VAL-FE-NOTIF-001).
 */
function formatLocalIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function NotificationsLog() {
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<PublicNotification | null>(null);

  const sourceParam: NotificationSource | undefined =
    source === 'all' ? undefined : source;
  const statusParam: NotificationStatus | undefined =
    status === 'all' ? undefined : status;

  const notificationsQuery = useQuery({
    queryKey: ['notifications', sourceParam, statusParam],
    queryFn: () =>
      // Fetch with limit=100 (BE max) so users see all recent rows without
      // needing pagination (M5 polish — architecture §4: max limit 100).
      fetchNotifications({ source: sourceParam, status: statusParam, limit: 100 }),
  });

  // Close the modal on Escape (accessibility).
  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // ----- Loading skeleton (VAL-FE-NOTIF-007) -----
  if (notificationsQuery.isPending) {
    return (
      <div data-testid="notif-skeleton" className="space-y-3">
        <div className="flex gap-3">
          <Skeleton rows={1} className="h-8 w-32" />
          <Skeleton rows={1} className="h-8 w-32" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700"
            />
          ))}
        </div>
      </div>
    );
  }

  // ----- 5xx / network error with Retry (VAL-FE-ERR-002) -----
  if (notificationsQuery.isError) {
    return (
      <ErrorState
        message="We couldn't load your notifications. Please try again."
        onRetry={() => notificationsQuery.refetch()}
      />
    );
  }

  const rows: PublicNotification[] = notificationsQuery.data;

  return (
    <div data-testid="notif-page">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Notifications
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Delivery log for your subscribers (newest first).
        </p>
      </header>

      {/* Filters: source + status dropdowns (VAL-FE-NOTIF-002/006). */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <span className="font-medium">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as SourceFilter)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            data-testid="notif-source-filter"
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <span className="font-medium">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            data-testid="notif-status-filter"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          variant="zero"
          message="No notifications yet"
          description="When your subscribers receive notifications, they'll be logged here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table
            className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"
            data-testid="notif-table"
          >
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th testId="notif-th-deliveredAt">deliveredAt</Th>
                <Th testId="notif-th-source">source</Th>
                <Th testId="notif-th-subscriberId">subscriberId</Th>
                <Th testId="notif-th-referenceId">referenceId</Th>
                <Th testId="notif-th-status">status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                  data-testid="notif-row"
                  data-notification-id={row.id}
                >
                  <Td>
                    <span data-testid="notif-cell-deliveredAt">
                      {formatLocalIso(row.deliveredAt)}
                    </span>
                  </Td>
                  <Td>
                    <span data-testid="notif-cell-source">{row.source}</span>
                  </Td>
                  <Td>
                    <span
                      className="font-mono text-xs"
                      data-testid="notif-cell-subscriberId"
                    >
                      {row.subscriberId}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="font-mono text-xs"
                      data-testid="notif-cell-referenceId"
                    >
                      {row.referenceId}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={row.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <PayloadModal
          notification={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Th({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <th
      scope="col"
      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
      data-testid={testId}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: NotificationStatus }) {
  const cls =
    status === 'sent'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : status === 'mocked'
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
      data-testid="notif-cell-status"
    >
      {status}
    </span>
  );
}

/**
 * Payload modal (VAL-FE-NOTIF-003 / VAL-FE-NOTIF-004).
 *
 * Serializes the notification's `payload` as pretty-printed JSON inside a
 * `<pre>`. The payload's `webhookUrl` field is already redacted by the
 * backend (`/webhooks/.../<last-4>`), so the raw Discord webhook URL is
 * never rendered.
 */
function PayloadModal({
  notification,
  onClose,
}: {
  notification: PublicNotification;
  onClose: () => void;
}) {
  const payloadJson = JSON.stringify(notification.payload, null, 2);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      data-testid="notif-modal-backdrop"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
        data-testid="notif-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Notification payload"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Notification payload
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Close payload modal"
            data-testid="notif-modal-close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">
          <dl className="mb-3 grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <dt className="font-medium">deliveredAt</dt>
            <dd className="col-span-2 font-mono">
              {formatLocalIso(notification.deliveredAt)}
            </dd>
            <dt className="font-medium">source</dt>
            <dd className="col-span-2">{notification.source}</dd>
            <dt className="font-medium">referenceId</dt>
            <dd className="col-span-2 font-mono">{notification.referenceId}</dd>
            <dt className="font-medium">status</dt>
            <dd className="col-span-2">{notification.status}</dd>
            {notification.error && (
              <>
                <dt className="font-medium">error</dt>
                <dd className="col-span-2 font-mono text-red-600 dark:text-red-400">
                  {notification.error}
                </dd>
              </>
            )}
          </dl>
          {/* Payload JSON rendered as TEXT inside a <pre> — the redacted
              webhook URL (`/webhooks/.../<last-4>`) is the only webhook
              reference that ever appears (VAL-FE-NOTIF-004). */}
          <pre
            className="overflow-auto rounded bg-gray-900 p-3 text-xs leading-relaxed text-gray-100"
            data-testid="notif-modal-payload"
          >
            {payloadJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
