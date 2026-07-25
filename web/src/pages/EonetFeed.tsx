import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEonetCategories, fetchEonetEvents } from '../api/eonet';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { EonetCategory, EonetEvent, EonetStatus } from '../types';

/**
 * EONET Feed (architecture §6 / VAL-FE-EONET-001..007, VAL-FE-ERR-003,
 * VAL-CROSS-010).
 *
 * Filters — both applied simultaneously to the events request:
 * - Category chips (single-select; "All" clears). The selected chip is the
 *   `category=...` query param.
 * - Status pills (`All` / `Open` / `Closed`). The selected pill is the
 *   `status=...` query param.
 * When both are active the request carries `category=...&status=...` and the
 * list reflects their intersection (VAL-FE-EONET-005). Each active filter has
 * a visible affordance (distinct chip/pill style + a removable "active
 * filter" badge above the list).
 *
 * Cross-page UX policy:
 * - Loading skeleton while the events query is pending (VAL-FE-EONET-007).
 * - Distinct empty states: zero-total ("No events tracked yet") vs.
 *   filter-no-match ("No events match this filter") (VAL-FE-EONET-004/006).
 * - Inline error + Retry on 5xx / network failure (VAL-FE-ERR-003).
 *
 * Each event renders an `open`/`closed` status pill (VAL-FE-EONET-001).
 * Pagination (50 per page) navigates the filtered result set
 * (VAL-CROSS-010); page resets to 1 whenever a filter changes.
 */
const PAGE_SIZE = 50;

type StatusFilter = EonetStatus | 'all';

export function EonetFeed() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const categoriesQuery = useQuery({
    queryKey: ['eonet', 'categories'],
    queryFn: fetchEonetCategories,
    // Categories change rarely; keep them fresh-ish but don't refetch on
    // every filter toggle.
    staleTime: 60_000,
  });

  const statusParam: EonetStatus | undefined =
    status === 'all' ? undefined : status;

  const eventsQuery = useQuery({
    queryKey: ['eonet', 'events', category, statusParam, page],
    queryFn: () =>
      fetchEonetEvents({
        category,
        status: statusParam,
        page,
        limit: PAGE_SIZE,
      }),
  });

  function selectCategory(slug: string | undefined) {
    setCategory(slug);
    setPage(1);
  }

  function selectStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
  }

  const total = eventsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = category !== undefined || statusParam !== undefined;

  // ----- Loading skeleton (VAL-FE-EONET-007) -----
  if (eventsQuery.isPending) {
    return (
      <div data-testid="eonet-skeleton" className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-8 w-28 animate-pulse rounded-full bg-deep-space-lighter"
            />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card-cosmic space-y-2 p-4">
              <Skeleton rows={2} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ----- 5xx / network error with Retry (VAL-FE-ERR-003) -----
  if (eventsQuery.isError) {
    return (
      <ErrorState
        message="We couldn't load the EONET feed. Please try again."
        onRetry={() => eventsQuery.refetch()}
      />
    );
  }

  const events: EonetEvent[] = eventsQuery.data.data;
  const categories: EonetCategory[] = categoriesQuery.data ?? [];
  const isFilteredEmpty = total === 0 && hasFilter;
  const isZeroTotal = total === 0 && !hasFilter;

  return (
    <div data-testid="eonet-feed">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold text-star-white">
          EONET Feed
        </h1>
        <p className="text-sm text-muted">
          Natural events tracked from NASA's EONET API.
        </p>
      </header>

      {/* Active-filter affordances: removable badges for each active filter
          (VAL-FE-EONET-002 / VAL-FE-EONET-005 "visible affordance"). */}
      {hasFilter && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2"
          data-testid="eonet-active-filters"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Active filters:
          </span>
          {category && (
            <button
              type="button"
              onClick={() => selectCategory(undefined)}
              className="inline-flex items-center gap-1 rounded-full border border-nebula-purple/40 bg-nebula-purple/15 px-3 py-1 text-xs font-medium text-nebula-purple-soft hover:bg-nebula-purple/25"
              data-testid="eonet-active-filter"
              data-filter="category"
            >
              {category}
              <span aria-hidden>×</span>
            </button>
          )}
          {statusParam && (
            <button
              type="button"
              onClick={() => selectStatus('all')}
              className="inline-flex items-center gap-1 rounded-full border border-nebula-purple/40 bg-nebula-purple/15 px-3 py-1 text-xs font-medium text-nebula-purple-soft hover:bg-nebula-purple/25"
              data-testid="eonet-active-filter"
              data-filter="status"
            >
              {statusParam}
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
      )}

      {/* Category chips (VAL-FE-EONET-001/002). Single-select; "All" clears.
          M5 polish: surfaces an inline ErrorState+Retry when
          /api/nasa/eonet/categories 5xx errors so users see 'failed to load
          categories', not just 'All'. */}
      <div
        className="mb-3 flex flex-wrap gap-2"
        data-testid="eonet-category-chips"
      >
        <CategoryChip
          label="All"
          active={category === undefined}
          onClick={() => selectCategory(undefined)}
        />
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            label={c.title}
            active={category === c.id}
            onClick={() => selectCategory(c.id)}
            data-category={c.id}
          />
        ))}
        {categoriesQuery.isPending && (
          <span
            className="text-xs text-muted"
            data-testid="eonet-categories-loading"
          >
            Loading categories…
          </span>
        )}
        {categoriesQuery.isError && (
          <div
            className="flex items-center gap-2"
            data-testid="eonet-categories-error"
          >
            <span className="text-xs text-cosmic-error">
              Failed to load categories
            </span>
            <button
              type="button"
              onClick={() => categoriesQuery.refetch()}
              className="rounded border border-cosmic-error/50 px-2 py-0.5 text-xs font-medium text-cosmic-error hover:bg-cosmic-error/10"
              data-testid="eonet-categories-retry"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Status pills (VAL-FE-EONET-001/003). */}
      <div
        className="mb-4 flex flex-wrap gap-2"
        data-testid="eonet-status-pills"
      >
        <StatusPill
          label="All"
          active={status === 'all'}
          onClick={() => selectStatus('all')}
          data-status="all"
        />
        <StatusPill
          label="Open"
          active={status === 'open'}
          onClick={() => selectStatus('open')}
          data-status="open"
        />
        <StatusPill
          label="Closed"
          active={status === 'closed'}
          onClick={() => selectStatus('closed')}
          data-status="closed"
        />
      </div>

      {/* Empty states (VAL-FE-EONET-004 / VAL-FE-EONET-006). */}
      {isZeroTotal && (
        <EmptyState
          variant="zero"
          message="No events tracked yet"
          description="Once the EONET scheduler polls NASA, events will appear here."
        />
      )}
      {isFilteredEmpty && (
        <EmptyState
          variant="filtered"
          message="No events match this filter"
          description="Try clearing a filter or picking a different category/status."
        />
      )}

      {/* Event list with per-event status pills (VAL-FE-EONET-001). */}
      {total > 0 && (
        <ul className="space-y-3" data-testid="eonet-event-list">
          {events.map((event) => (
            <EonetEventCard key={event.id} event={event} />
          ))}
        </ul>
      )}

      {/* Pagination through the filtered result set (VAL-CROSS-010).
          Hidden on zero/filtered-empty (VAL-FE-EONET-006). */}
      {total > 0 && (
        <nav
          className="mt-6 flex items-center justify-between"
          aria-label="EONET pagination"
          data-testid="eonet-pagination"
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="eonet-prev"
          >
            ← Previous
          </button>
          <span className="text-sm text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="eonet-next"
          >
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CategoryChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  'data-category'?: string;
}

function CategoryChip({
  label,
  active,
  onClick,
  ...rest
}: CategoryChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      data-testid="eonet-category-chip"
      className={
        active
          ? 'rounded-full border border-nebula-purple bg-nebula-purple/20 px-3 py-1 text-sm font-medium text-star-white shadow-[0_0_0_1px_rgba(139,92,246,0.35)] focus:outline-none focus:ring-2 focus:ring-nebula-purple-soft'
          : 'rounded-full border border-nebula-purple/30 bg-deep-space-darker/60 px-3 py-1 text-sm font-medium text-muted hover:border-nebula-purple/60 hover:text-star-white focus:outline-none focus:ring-2 focus:ring-nebula-purple-soft'
      }
      {...rest}
    >
      {label}
    </button>
  );
}

interface StatusPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  'data-status'?: string;
}

function StatusPill({ label, active, onClick, ...rest }: StatusPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      data-testid="eonet-status-pill"
      className={
        active
          ? 'rounded-full border border-nebula-purple bg-nebula-purple/20 px-3 py-1 text-sm font-medium text-star-white shadow-[0_0_0_1px_rgba(139,92,246,0.35)] focus:outline-none focus:ring-2 focus:ring-nebula-purple-soft'
          : 'rounded-full border border-nebula-purple/30 bg-deep-space-darker/60 px-3 py-1 text-sm font-medium text-muted hover:border-nebula-purple/60 hover:text-star-white focus:outline-none focus:ring-2 focus:ring-nebula-purple-soft'
      }
      {...rest}
    >
      {label}
    </button>
  );
}

function EonetEventCard({ event }: { event: EonetEvent }) {
  const isOpen = event.status === 'open';
  return (
    <li className="card-cosmic p-4" data-testid="eonet-event-card">
      <div className="flex items-start justify-between gap-3">
        {/* Title rendered as TEXT content — never dangerouslySetInnerHTML
            (architecture §6 security). */}
        <h2
          className="truncate text-base font-semibold text-star-white"
          title={event.title}
          data-testid="eonet-event-title"
        >
          {event.title}
        </h2>
        <span
          className={
            isOpen
              ? 'inline-flex shrink-0 items-center rounded-full border border-cosmic-success/40 bg-cosmic-success/15 px-2.5 py-0.5 text-xs font-medium text-cosmic-success'
              : 'inline-flex shrink-0 items-center rounded-full border border-muted/30 bg-deep-space-lighter px-2.5 py-0.5 text-xs font-medium text-muted'
          }
          data-testid="eonet-event-status"
        >
          {event.status}
        </span>
      </div>
      {event.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted">
          {event.description}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span data-testid="eonet-event-id">{event.id}</span>
        {event.link && (
          <a
            href={event.link}
            target="_blank"
            rel="noreferrer noopener"
            className="text-nebula-purple-soft hover:text-star-white"
          >
            EONET page
          </a>
        )}
      </div>
    </li>
  );
}
