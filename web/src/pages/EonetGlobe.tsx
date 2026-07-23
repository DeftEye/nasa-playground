import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEonetMap } from '../api/eonet';
import { fetchCountries } from '../lib/globe/countries';
import { categoryColor, type CountryFeature } from '../lib/globe/geo';
import { GlobeView } from '../components/globe/GlobeView';
import { GlobeErrorBoundary } from '../components/globe/GlobeErrorBoundary';
import { webglAvailable } from '../components/globe/webgl';
import { Skeleton } from '../components/Skeleton';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import type { EonetMapEvent } from '../types';

/**
 * EonetGlobe — the `/globe` page shell (architecture §16.2 /
 * `library/eonet-globe.md`).
 *
 * M10 part 1 scope (this feature): scaffold + render. Fetches the map
 * endpoint with the default 30-day window, renders the react-globe.gl globe
 * (country polygons + event points colored by category with hover titles)
 * when WebGL is available, and ALWAYS renders the assertable DOM mirror
 * layer (`globe-event-point` per plotted event with `data-event-id` /
 * `data-category` / `data-status` / `data-title`, plus `globe-events-count`).
 *
 * When WebGL is unavailable (synchronous guard) or the `GlobeErrorBoundary`
 * catches a render-phase WebGL failure, `globe-webgl-unavailable` is shown
 * AND the DOM mirror still renders — the page stays testable without WebGL
 * (VAL-GLOBE-022 / VAL-GLOBE-023).
 *
 * The filter bar (`globe-filter-*`), dedicated loading/empty/error testids
 * (`globe-skeleton`, `globe-empty`, `globe-error`), and country-click side
 * panel are owned by the `m10-globe-filter-bar` and M11 features and are
 * intentionally NOT implemented here.
 *
 * The map endpoint is the ONLY data source for plotted points
 * (VAL-GLOBE-026); the legacy `/events` list endpoint is never called on
 * this page. Titles are rendered as JSX text — no `dangerouslySetInnerHTML`
 * (VAL-GLOBE-025).
 */

const DEFAULT_WINDOW_DAYS = 30;

export function EonetGlobe() {
  // Synchronous WebGL probe — runs once on mount, before the first render
  // decides whether to mount the canvas (VAL-GLOBE-022).
  const webglOk = useMemo(() => webglAvailable(), []);

  // The map endpoint is the sole data source for plotted points. Default
  // 30-day window, no category/status filters (VAL-GLOBE-017 / VAL-GLOBE-026).
  const mapQuery = useQuery({
    queryKey: ['eonet', 'map', { days: DEFAULT_WINDOW_DAYS }],
    queryFn: () => fetchEonetMap({ days: 30 }),
  });

  // Countries are only needed to render the globe polygons; skip the fetch
  // when WebGL is down (the DOM mirror does not need them).
  const countriesQuery = useQuery({
    queryKey: ['globe', 'countries'],
    queryFn: async (): Promise<CountryFeature[]> => {
      const fc = await fetchCountries();
      return fc.features as CountryFeature[];
    },
    enabled: webglOk,
    staleTime: Infinity,
  });

  const events: EonetMapEvent[] = mapQuery.data?.events ?? [];
  const countries: CountryFeature[] = countriesQuery.data ?? [];

  return (
    <div data-testid="globe-page" className="space-y-4">
      <header className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          EONET Globe
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Explore natural events from NASA's EONET on a 3D globe. Hover a point
          for its title.
        </p>
      </header>

      {/* Loading skeleton (shared component; the dedicated `globe-skeleton`
          testid is added by the filter-bar feature). */}
      {mapQuery.isPending && (
        <div className="rounded-lg border border-gray-200 p-6 dark:border-gray-700">
          <Skeleton rows={4} />
        </div>
      )}

      {/* 5xx / network error with Retry (shared component; the dedicated
          `globe-error` / `globe-error-retry` testids are added by the
          filter-bar feature). */}
      {mapQuery.isError && (
        <ErrorState
          message="We couldn't load the EONET map. Please try again."
          onRetry={() => mapQuery.refetch()}
        />
      )}

      {mapQuery.data && (
        <>
          {/* Globe area: canvas when WebGL is up, fallback when it is not.
              The DOM mirror below renders regardless of WebGL state. */}
          <div className="h-[520px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gradient-to-b from-sky-50 to-white dark:border-gray-700 dark:from-gray-900 dark:to-gray-800">
            {webglOk ? (
              <GlobeErrorBoundary>
                <GlobeView
                  countries={countries}
                  events={events}
                  onPolygonClick={() => {
                    /* country selection is owned by M11 */
                  }}
                  onPointClick={() => {
                    /* event detail is owned by M11 */
                  }}
                />
              </GlobeErrorBoundary>
            ) : (
              <div
                data-testid="globe-webgl-unavailable"
                role="status"
                className="flex h-full w-full items-center justify-center p-6 text-center"
              >
                <div>
                  <div className="mb-2 text-3xl">🌐</div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    3D globe is unavailable in this browser (WebGL is disabled
                    or unsupported).
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    The event list and count below still work.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Event count (VAL-GLOBE-009). */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Plotted events:{' '}
              <span
                data-testid="globe-events-count"
                className="font-semibold text-gray-900 dark:text-gray-100"
              >
                {events.length}
              </span>
            </span>
          </div>

          {/* Empty state when the window has no events (shared component;
              the dedicated `globe-empty` testid is added by the filter-bar
              feature). */}
          {events.length === 0 && (
            <EmptyState
              variant="zero"
              message="No events in this window"
              description="Try a wider time window (the filter bar is coming soon)."
            />
          )}

          {/* DOM mirror: one `globe-event-point` per plotted event, carrying
              data-event-id / data-category / data-status / data-title so the
              mirror is assertable without reading the canvas tooltip
              (VAL-GLOBE-006 / VAL-GLOBE-007 / VAL-GLOBE-008). Titles are
              rendered as JSX text (VAL-GLOBE-025) — never
              dangerouslySetInnerHTML. */}
          {events.length > 0 && (
            <ul
              className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-700"
              aria-label="Plotted EONET events"
            >
              {events.map((e) => {
                const firstCategory = e.categories?.[0]?.id ?? '';
                return (
                  <li
                    key={e.id}
                    data-testid="globe-event-point"
                    data-event-id={e.id}
                    data-category={firstCategory}
                    data-status={e.status}
                    data-title={e.title}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryColor(firstCategory) }}
                      aria-hidden
                    />
                    {/* Title rendered as TEXT content (XSS-safe). */}
                    <span className="truncate text-gray-900 dark:text-gray-100">
                      {e.title}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {e.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default EonetGlobe;
