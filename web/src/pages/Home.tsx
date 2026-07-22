import { useMutation, useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { fetchTodayApod, triggerApodFetch } from '../api/apod';
import { ApodHero } from '../components/ApodHero';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { ApodEntry } from '../types';

/** Type guard: returns the HTTP status of an axios-shaped error, or 0. */
function errorStatus(err: unknown): number {
  return (err as AxiosError)?.response?.status ?? 0;
}

/**
 * Home page — today's APOD (architecture §6 / VAL-FE-HOME-001..007,
 * VAL-FE-ERR-001).
 *
 * Data flow:
 * - TanStack Query fetches `GET /api/nasa/apod/today` (JWT attached by the
 *   axios interceptor).
 * - While pending → loading skeleton (VAL-FE-HOME-004).
 * - On 5xx / network error → inline error with a Retry button that re-runs
 *   the query (VAL-FE-ERR-001).
 * - On 404 (no row for today) → empty state with a manual trigger button
 *   that POSTs `/api/nasa/triggers/fetch-apod` and then refetches today
 *   (VAL-FE-HOME-007).
 * - On success → `<ApodHero>` renders the title, media (`<img>` or
 *   `<iframe>` for video), and explanation (VAL-FE-HOME-001/002/003/005/006).
 */
export function Home() {
  const todayQuery = useQuery<ApodEntry, unknown>({
    queryKey: ['apod', 'today'],
    queryFn: fetchTodayApod,
  });

  const triggerMutation = useMutation({
    mutationFn: () => triggerApodFetch(),
  });

  if (todayQuery.isPending) {
    return (
      <div data-testid="home-skeleton" className="space-y-4">
        <Skeleton rows={1} className="h-64 rounded-lg" />
        <Skeleton rows={4} />
      </div>
    );
  }

  // 404 → no row for today yet → empty state with a manual trigger button.
  if (errorStatus(todayQuery.error) === 404) {
    async function handleManualFetch() {
      await triggerApodFetch();
      await todayQuery.refetch();
    }
    return (
      <EmptyState
        variant="zero"
        message="Today's picture hasn't been fetched yet"
        description="Trigger a manual fetch to pull today's APOD from NASA."
        action={
          <button
            type="button"
            onClick={handleManualFetch}
            disabled={triggerMutation.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="home-trigger-fetch"
          >
            {triggerMutation.isPending ? 'Fetching…' : 'Fetch today’s picture'}
          </button>
        }
      />
    );
  }

  if (todayQuery.isError) {
    return (
      <ErrorState
        message="We couldn't load today's APOD. Please try again."
        onRetry={() => todayQuery.refetch()}
      />
    );
  }

  return <ApodHero entry={todayQuery.data} />;
}
