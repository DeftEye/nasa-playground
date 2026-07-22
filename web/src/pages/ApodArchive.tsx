import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApodArchive } from '../api/apod';
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
 * - Long titles truncate with `truncate` (text-ellipsis).
 */
const PAGE_SIZE = 20;

function parsePageParam(value: string | null): number {
  const n = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
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
      <EmptyState
        variant="zero"
        message="No APOD entries yet"
        description="Once the scheduler fetches pictures, they'll appear here."
      />
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          APOD Archive
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {total} {total === 1 ? 'entry' : 'entries'} · page {page} of{' '}
          {totalPages}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((entry: ApodEntry) => {
          const isVideo =
            entry.mediaType === 'video' && entry.videoUrl !== null;
          return (
            <article
              key={entry.date}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
              data-testid="apod-archive-card"
            >
              {isVideo ? (
                <div className="aspect-video w-full bg-black">
                  <iframe
                    src={entry.videoUrl as string}
                    title={entry.title}
                    className="h-full w-full"
                    data-testid="apod-archive-card-iframe"
                  />
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
