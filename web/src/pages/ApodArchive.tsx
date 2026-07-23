import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApodArchive, triggerApodBackfill } from '../api/apod';
import { triggerEonetBackfill } from '../api/eonet';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { ApodEntry } from '../types';

/**
 * APOD Archive — paginated grid of date+title cards
 * (architecture §6 / VAL-FE-ARCHIVE-001..005).
 *
 * Pagination state lives in the URL query string (`?page=N`). A direct deep
 * link to `/apod/archive?page=2` loads page 2 on mount (VAL-FE-ARCHIVE-002).
 * Prev/Next clicks update the URL (which re-runs the query via the
 * `page` query key).
 *
 * Cross-page UX policy:
 * - Loading skeleton while the list query is pending (VAL-FE-ARCHIVE-005).
 * - Empty state when the archive has zero rows (VAL-FE-ARCHIVE-003).
 * - Inline error + Retry on 5xx / network failure.
 *
 * Cards:
 * - Image entries render an `<img>` thumbnail.
 * - Video entries (`mediaType==='video'` AND `videoUrl != null`) render an
 *   `<iframe>` to the embed URL (VAL-FE-ARCHIVE-004).
 * - Video entries with `videoUrl == null` (non-embeddable host) render a
 *   "Watch video" link to the source `url` (new tab, `rel=noopener
 *   noreferrer`) instead of a broken `<img>` (VAL-FE-ARCHIVE-006).
 * - Long titles truncate with `truncate` (text-ellipsis).
 */
const PAGE_SIZE = 20;

function parsePageParam(value: string | null): number {
  const n = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

type BackfillStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

/** Returns the rejection reason of a settled promise, or `null` if fulfilled. */
function rejectReason<T>(result: PromiseSettledResult<T>): unknown | null {
  return result.status === 'rejected' ? result.reason : null;
}

/**
 * "Backfill 30 days" control (VAL-PRODFIX-007). An authenticated user can
 * populate APOD (+ EONET) history on demand by clicking the button, which
 * POSTs to the JWT-guarded backfill trigger endpoints via the authed axios
 * client (`apiClient`, baseURL `/api`):
 * - `POST /api/nasa/triggers/backfill-apod?days=30`
 * - `POST /api/nasa/triggers/backfill-eonet`
 *
 * While in-flight the button is disabled (pending state). A status message
 * (`apod-backfill-status`) reflects success/error. On success the APOD
 * archive react-query cache is invalidated so the list refetches and shows
 * the newly backfilled entries.
 */
function BackfillControl() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BackfillStatus>({ kind: 'idle' });

  async function handleBackfill() {
    setStatus({ kind: 'pending' });
    try {
      // Fire both backfill triggers. The APOD backfill is the one that
      // populates the archive; the EONET backfill keeps event history fresh
      // in lockstep (the control backfills both NASA feeds at once).
      const [apodResult, eonetResult] = await Promise.allSettled([
        triggerApodBackfill(30),
        triggerEonetBackfill(),
      ]);

      // Invalidate the archive cache regardless of the EONET result so any
      // newly upserted APOD rows surface. Only invalidate when the APOD
      // backfill itself succeeded.
      if (apodResult.status === 'fulfilled') {
        await queryClient.invalidateQueries({ queryKey: ['apod', 'archive'] });
      }

      if (apodResult.status === 'rejected' || eonetResult.status === 'rejected') {
        const failed = rejectReason(apodResult) ?? rejectReason(eonetResult);
        const message =
          (failed as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ??
          (failed instanceof Error ? failed.message : 'Backfill failed. Please try again.');
        setStatus({ kind: 'error', message });
        return;
      }

      const count = apodResult.value.length;
      setStatus({
        kind: 'success',
        message:
          count > 0
            ? `Backfill complete — ${count} APOD entries refreshed.`
            : 'Backfill complete. Archive refreshed.',
      });
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (err instanceof Error ? err.message : 'Backfill failed. Please try again.');
      setStatus({ kind: 'error', message });
    }
  }

  const isPending = status.kind === 'pending';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleBackfill}
        disabled={isPending}
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="apod-backfill-button"
        aria-busy={isPending}
      >
        {isPending ? 'Backfilling…' : 'Backfill 30 days'}
      </button>
      {status.kind !== 'idle' && (
        <p
          role="status"
          aria-live="polite"
          data-testid="apod-backfill-status"
          className={
            status.kind === 'error'
              ? 'text-sm text-red-600 dark:text-red-400'
              : status.kind === 'success'
                ? 'text-sm text-green-600 dark:text-green-400'
                : 'text-sm text-gray-500 dark:text-gray-400'
          }
        >
          {status.kind === 'pending'
            ? 'Backfilling history…'
            : status.kind === 'success'
              ? status.message
              : status.kind === 'error'
                ? status.message
                : ''}
        </p>
      )}
    </div>
  );
}

export function ApodArchive() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePageParam(searchParams.get('page'));

  const archiveQuery = useQuery({
    queryKey: ['apod', 'archive', page],
    queryFn: () => fetchApodArchive({ page, limit: PAGE_SIZE }),
  });

  const totalPages = useMemo(() => {
    const total = archiveQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [archiveQuery.data?.total]);

  function goToPage(next: number) {
    const target = Math.min(Math.max(1, next), totalPages);
    setSearchParams(
      target === 1 ? {} : { page: String(target) },
      { replace: false },
    );
  }

  if (archiveQuery.isPending) {
    return (
      <div data-testid="archive-skeleton" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            >
              <Skeleton rows={1} className="h-32" />
              <Skeleton rows={2} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (archiveQuery.isError) {
    return (
      <ErrorState
        message="We couldn't load the APOD archive. Please try again."
        onRetry={() => archiveQuery.refetch()}
      />
    );
  }

  const { data: list, total } = archiveQuery.data;

  if (total === 0) {
    return (
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            APOD Archive
          </h1>
        </div>
        <EmptyState
          variant="zero"
          message="No APOD entries yet"
          description="Backfill the last 30 days, or wait for the scheduler to fetch pictures."
          action={<BackfillControl />}
        />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              APOD Archive
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {total} {total === 1 ? 'entry' : 'entries'} · page {page} of{' '}
              {totalPages}
            </p>
          </div>
          {/* VAL-PRODFIX-007: on-demand history backfill for authed users. */}
          <BackfillControl />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((entry: ApodEntry) => {
          const isVideo = entry.mediaType === 'video';
          const hasEmbed = entry.videoUrl !== null;
          return (
            <article
              key={entry.date}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
              data-testid="apod-archive-card"
            >
              {isVideo && hasEmbed ? (
                <div className="aspect-video w-full bg-black">
                  <iframe
                    src={entry.videoUrl as string}
                    title={entry.title}
                    className="h-full w-full"
                    data-testid="apod-archive-card-iframe"
                  />
                </div>
              ) : isVideo && !hasEmbed ? (
                // Non-embeddable video: a "Watch video" link to the source
                // `url` (new tab, `rel=noopener noreferrer`) instead of a
                // broken `<img>` (VAL-FE-ARCHIVE-006).
                <div className="flex aspect-video w-full items-center justify-center bg-black">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    data-testid="apod-archive-card-watch-link"
                  >
                    <span aria-hidden="true">▶</span> Watch video
                  </a>
                </div>
              ) : (
                <div className="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                  <img
                    src={entry.url}
                    alt={entry.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    data-testid="apod-archive-card-image"
                  />
                </div>
              )}
              <div className="p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {entry.date}
                </p>
                <p
                  className="mt-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100"
                  title={entry.title}
                >
                  {entry.title}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <nav
        className="mt-6 flex items-center justify-between"
        aria-label="Archive pagination"
        data-testid="archive-pagination"
      >
        <button
          type="button"
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          data-testid="archive-prev"
        >
          ← Previous
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          data-testid="archive-next"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}
