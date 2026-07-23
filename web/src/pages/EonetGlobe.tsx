import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEonetMap, fetchEonetCategories } from '../api/eonet';
import {
  fetchCountries,
  findCountryByAdm0A3,
  countryName,
  countryId,
} from '../lib/globe/countries';
import {
  categoryColor,
  eventsInCountry,
  type CountryFeature,
} from '../lib/globe/geo';
import { GlobeView } from '../components/globe/GlobeView';
import { GlobeErrorBoundary } from '../components/globe/GlobeErrorBoundary';
import { webglAvailable } from '../components/globe/webgl';
import { Skeleton } from '../components/Skeleton';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import type { EonetCategory, EonetMapEvent, EonetStatus } from '../types';

/**
 * EonetGlobe — the `/globe` page shell (architecture §16.2 /
 * `library/eonet-globe.md`).
 *
 * Renders a top filter bar (`globe-filter-category` / `globe-filter-status` /
 * `globe-filter-window`) wired to the react-query fetch of the map endpoint.
 * The query key includes `days`/`category`/`status`; any filter change
 * refetches the map endpoint and updates the plotted point set +
 * `globe-events-count` (VAL-GLOBE-013..017). The window control MUST refetch
 * because the server applies the date window (VAL-GLOBE-015). Combined
 * filters are applied together as an intersection (VAL-GLOBE-016). Initial
 * load uses the default 30-day window with no category/status filters
 * (VAL-GLOBE-017).
 *
 * Dedicated cross-page UX states with stable testids:
 * - `globe-skeleton` while the map query is fetching (VAL-GLOBE-018).
 * - `globe-empty` when the window has zero events ("no events in this
 *   window", distinct from error) (VAL-GLOBE-019).
 * - `globe-error` + `globe-error-retry` on 5xx; retry re-runs the query
 *   (VAL-GLOBE-020 / VAL-GLOBE-021).
 *
 * When WebGL is unavailable (synchronous guard) or the `GlobeErrorBoundary`
 * catches a render-phase WebGL failure, `globe-webgl-unavailable` is shown
 * AND the filter bar + DOM mirror still render — the page stays testable
 * and the filters remain functional without WebGL (VAL-GLOBE-022 /
 * VAL-GLOBE-023 / VAL-GLOBE-024).
 *
 * The map endpoint is the ONLY data source for plotted points
 * (VAL-GLOBE-026); the legacy `/events` list endpoint is never called on
 * this page. Titles are rendered as JSX text — no `dangerouslySetInnerHTML`
 * (VAL-GLOBE-025).
 */

const DEFAULT_WINDOW_DAYS = 30;
const WINDOW_OPTIONS: ReadonlyArray<7 | 14 | 30> = [7, 14, 30];

type StatusFilter = EonetStatus | 'all';

interface GlobeFilters {
  days: 7 | 14 | 30;
  category: string; // slug, or 'all'
  status: StatusFilter;
}

/** Converts the UI filter state into map-endpoint query params. `'all'`
 *  values are translated to `undefined` so the backend does not receive an
 *  invalid `status=all` (the DTO only allows `open`/`closed`) and so the
 *  initial request carries no category/status (VAL-GLOBE-017). */
function mapParamsFromFilters(f: GlobeFilters) {
  return {
    days: f.days,
    category: f.category !== 'all' ? f.category : undefined,
    status: f.status !== 'all' ? f.status : undefined,
  };
}

export function EonetGlobe() {
  // Synchronous WebGL probe — runs once on mount, before the first render
  // decides whether to mount the canvas (VAL-GLOBE-022).
  const webglOk = useMemo(() => webglAvailable(), []);

  // Filter state. Initial load: 30-day window, no category/status filters
  // (VAL-GLOBE-017).
  const [filters, setFilters] = useState<GlobeFilters>({
    days: DEFAULT_WINDOW_DAYS,
    category: 'all',
    status: 'all',
  });

  const mapParams = mapParamsFromFilters(filters);

  // The map endpoint is the sole data source for plotted points. The query
  // key includes days/category/status so any filter change refetches
  // (VAL-GLOBE-013..017 / VAL-GLOBE-026).
  const mapQuery = useQuery({
    queryKey: ['eonet', 'map', { days: filters.days, category: filters.category, status: filters.status }],
    queryFn: () => fetchEonetMap(mapParams),
  });

  // Categories populate the category <select> options (VAL-GLOBE-010).
  // Fetched once, cached; the select still renders with just 'all' while
  // pending.
  const categoriesQuery = useQuery({
    queryKey: ['eonet', 'categories'],
    queryFn: fetchEonetCategories,
    staleTime: 60_000,
  });

  // Countries are needed for BOTH the globe polygons (rendered only when
  // WebGL is up) AND the side-panel point-in-polygon hit-testing (which
  // works without WebGL — VAL-GCROSS-014). So the countries fetch is always
  // enabled; the DOM mirror / side panel stay functional headless.
  const countriesQuery = useQuery({
    queryKey: ['globe', 'countries'],
    queryFn: async (): Promise<CountryFeature[]> => {
      const fc = await fetchCountries();
      return fc.features as CountryFeature[];
    },
    staleTime: Infinity,
  });

  const events: EonetMapEvent[] = useMemo(
    () => mapQuery.data?.events ?? [],
    [mapQuery.data],
  );
  const countries: CountryFeature[] = useMemo(
    () => countriesQuery.data ?? [],
    [countriesQuery.data],
  );
  const categories: EonetCategory[] = categoriesQuery.data ?? [];

  // --- Country selection (M11 / VAL-COUNTRY-001..020) ---------------------
  // The selected country feature, or undefined when nothing is selected.
  // `globe-selected-country` reads `none` before selection (VAL-COUNTRY-001).
  const [selectedFeature, setSelectedFeature] = useState<CountryFeature | undefined>();
  // The event whose detail panel is open (VAL-COUNTRY-008 / VAL-GCROSS-010).
  const [selectedEvent, setSelectedEvent] = useState<EonetMapEvent | undefined>();

  const selectedAdm0a3 = selectedFeature ? countryId(selectedFeature) : undefined;
  const selectedCountryName = selectedFeature ? countryName(selectedFeature) : 'none';

  /**
   * The single `selectCountry` handler used by `onPolygonClick`, the
   * `window.__selectCountry` test hook, and the hidden
   * `globe-test-select-<ADM0_A3>` buttons (VAL-COUNTRY-015). Accepts either a
   * full GeoJSON feature or an `ADM0_A3` string (resolved against the loaded
   * countries dataset). Selecting a country opens the side panel and clears
   * any open event detail so no stale detail leaks across countries
   * (VAL-GCROSS-009).
   */
  const selectCountry = useCallback((input: CountryFeature | string) => {
    const feature =
      typeof input === 'string'
        ? findCountryByAdm0A3(countries, input)
        : input;
    if (!feature) {
      // Unknown ADM0_A3 (e.g. countries not yet loaded) — ignore rather than
      // opening an empty panel with stale state.
      return;
    }
    setSelectedFeature(feature);
    setSelectedEvent(undefined);
  }, [countries]);

  const closeSidePanel = useCallback(() => {
    setSelectedFeature(undefined);
    setSelectedEvent(undefined);
  }, []);

  // Side-panel events are derived from the CURRENTLY LOADED events (the
  // active window/filters) via point-in-polygon — no separate query
  // (VAL-COUNTRY-011/012/013/014, VAL-COUNTRY-019). Re-derives automatically
  // when `events` changes (filter/window refetch).
  const countryEvents = useMemo<EonetMapEvent[]>(() => {
    if (!selectedFeature) return [];
    return eventsInCountry(events, selectedFeature);
  }, [events, selectedFeature]);

  // Install the `window.__selectCountry` test hook (VAL-COUNTRY-015). Routes
  // through the same `selectCountry` handler as `onPolygonClick`. Attached
  // on mount, removed on unmount. `selectCountry` is stable enough because
  // it closes over `countries` (re-installed when countries load changes the
  // closure); we re-attach whenever `countries` changes so an ADM0_A3 string
  // resolves correctly once the dataset is available.
  useEffect(() => {
    window.__selectCountry = (input: CountryFeature | string) => {
      selectCountry(input);
    };
    return () => {
      delete window.__selectCountry;
    };
  }, [selectCountry]);

  return (
    <div data-testid="globe-page" className="space-y-4">
      <header className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          EONET Globe
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Explore natural events from NASA's EONET on a 3D globe. Hover a point
          for its title, click a country to see its events.
        </p>
      </header>

      {/* Filter bar — renders in every state (loading/empty/error/WebGL-down)
          so filters remain interactive (VAL-GLOBE-024). */}
      <GlobeFilterBar
        filters={filters}
        categories={categories}
        onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
      />

      {/* Selected country indicator — always rendered; reads `none` before
          selection (VAL-COUNTRY-001). */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        Selected country:{' '}
        <span
          data-testid="globe-selected-country"
          className="font-semibold text-gray-900 dark:text-gray-100"
        >
          {selectedCountryName}
        </span>
      </div>

      {/* Loading skeleton (VAL-GLOBE-018). Dedicated `globe-skeleton` testid
          in addition to the shared Skeleton. */}
      {mapQuery.isPending && (
        <div
          data-testid="globe-skeleton"
          className="rounded-lg border border-gray-200 p-6 dark:border-gray-700"
        >
          <Skeleton rows={4} />
        </div>
      )}

      {/* 5xx / network error with Retry (VAL-GLOBE-020 / VAL-GLOBE-021).
          Dedicated `globe-error` + `globe-error-retry` testids. In the error
          state country selection is unavailable and the side panel stays
          absent (VAL-COUNTRY-020). */}
      {mapQuery.isError && (
        <div data-testid="globe-error" role="alert">
          <ErrorState
            message="We couldn't load the EONET map. Please try again."
            onRetry={() => mapQuery.refetch()}
            retryTestId="globe-error-retry"
          />
        </div>
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
                  selectedAdm0a3={selectedAdm0a3}
                  onPolygonClick={(feat) => selectCountry(feat)}
                  onPointClick={(evt) => setSelectedEvent(evt)}
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
                    The event list and country side panel still work.
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

          {/* Empty state when the window has no events (VAL-GLOBE-019).
              Distinct copy from the error state and from the country-empty
              state (VAL-GCROSS-016); dedicated `globe-empty` testid. */}
          {events.length === 0 && (
            <div data-testid="globe-empty">
              <EmptyState
                variant="zero"
                message="No events in this window"
                description="Try a wider time window or a different category/status filter."
              />
            </div>
          )}

          {/* DOM mirror: one `globe-event-point` per plotted event, carrying
              data-event-id / data-category / data-status / data-title so the
              mirror is assertable without reading the canvas tooltip
              (VAL-GLOBE-006 / VAL-GLOBE-007 / VAL-GLOBE-008). Titles are
              rendered as JSX text (VAL-GLOBE-025) — never
              dangerouslySetInnerHTML. Clicking a mirror row opens the event
              detail (VAL-COUNTRY-008 / VAL-GCROSS-010). */}
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
                    onClick={() => setSelectedEvent(e)}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
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

          {/* Side panel: rendered only when a country is selected
              (VAL-COUNTRY-001/002). Lists that country's events from the
              CURRENTLY LOADED set (point-in-polygon, no separate query —
              VAL-COUNTRY-019). */}
          {selectedFeature && (
            <aside
              data-testid="globe-side-panel"
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              aria-label={`Events in ${selectedCountryName}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {selectedCountryName}
                </h2>
                <button
                  type="button"
                  data-testid="globe-side-panel-close"
                  onClick={closeSidePanel}
                  aria-label={`Close ${selectedCountryName} panel`}
                  className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                >
                  ✕
                </button>
              </div>

              <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                Events in this country:{' '}
                <span
                  data-testid="globe-country-events-count"
                  className="font-semibold text-gray-900 dark:text-gray-100"
                >
                  {countryEvents.length}
                </span>
              </div>

              {countryEvents.length > 0 ? (
                <ul
                  data-testid="globe-country-events"
                  className="space-y-1"
                  aria-label={`Event list for ${selectedCountryName}`}
                >
                  {countryEvents.map((e) => {
                    const firstCategory = e.categories?.[0]?.id ?? '';
                    return (
                      <li
                        key={e.id}
                        data-testid="globe-country-event"
                        data-event-id={e.id}
                        data-category={firstCategory}
                        data-status={e.status}
                        onClick={() => setSelectedEvent(e)}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: categoryColor(firstCategory) }}
                          aria-hidden
                        />
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
              ) : (
                // Distinct empty state for a selected country with no
                // matching events (VAL-COUNTRY-006 / VAL-GCROSS-016).
                <div data-testid="globe-country-empty">
                  <EmptyState
                    variant="filtered"
                    message="No events in this country"
                    description="No loaded events fall inside this country for the current window/filters."
                  />
                </div>
              )}
            </aside>
          )}

          {/* Event detail: shown when an event point/row is clicked
              (VAL-COUNTRY-008 / VAL-GCROSS-010). Contains the title and a
              safe external EONET link (new tab, rel=noopener noreferrer, no
              token in the URL — VAL-COUNTRY-009). */}
          {selectedEvent && (
            <div
              data-testid="globe-event-detail"
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              role="dialog"
              aria-label={`Event detail: ${selectedEvent.title}`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {/* Title rendered as TEXT content (XSS-safe). */}
                  {selectedEvent.title}
                </h3>
                <button
                  type="button"
                  data-testid="globe-event-detail-close"
                  onClick={() => setSelectedEvent(undefined)}
                  aria-label="Close event detail"
                  className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                >
                  ✕
                </button>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <p>
                  Status:{' '}
                  <span className="font-medium">{selectedEvent.status}</span>
                </p>
                {selectedEvent.categories && selectedEvent.categories.length > 0 && (
                  <p>
                    Categories:{' '}
                    <span className="font-medium">
                      {selectedEvent.categories.map((c) => c.title).join(', ')}
                    </span>
                  </p>
                )}
                <p className="mt-2">
                  <a
                    data-testid="globe-event-link"
                    href={selectedEvent.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Open on NASA EONET ↗
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Hidden test-select buttons — one per loaded country — so
              validators can drive country selection deterministically
              without a canvas hit-test (VAL-COUNTRY-015). Each button routes
              through the same `selectCountry` handler as `onPolygonClick`.
              `display:none` keeps them out of the visual layout while
              remaining clickable via `.click()` / agent-browser eval. */}
          <div aria-hidden className="hidden">
            {countries.map((f) => {
              const id = countryId(f);
              if (!id) return null;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`globe-test-select-${id}`}
                  onClick={() => selectCountry(f)}
                  tabIndex={-1}
                >
                  {countryName(f)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface GlobeFilterBarProps {
  filters: GlobeFilters;
  categories: EonetCategory[];
  onChange: (patch: Partial<GlobeFilters>) => void;
}

/**
 * The top filter bar: category select, status select, and a segmented
 * 7/14/30-day window control. Each control carries a stable testid and
 * stable option values (VAL-GLOBE-010 / VAL-GLOBE-011 / VAL-GLOBE-012).
 *
 * The filter bar renders in every page state (loading, empty, error,
 * WebGL-unavailable) so filtering stays functional without WebGL
 * (VAL-GLOBE-024).
 */
function GlobeFilterBar({ filters, categories, onChange }: GlobeFilterBarProps) {
  return (
    <div
      className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
      data-testid="globe-filter-bar"
    >
      {/* Category select — 'all' + one option per category slug
          (VAL-GLOBE-010). */}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
        Category
        <select
          data-testid="globe-filter-category"
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      {/* Status select — all/open/closed, default 'all' (VAL-GLOBE-011). */}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
        Status
        <select
          data-testid="globe-filter-status"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      {/* Window segmented control — 7/14/30, default 30 (VAL-GLOBE-012).
          Rendered as a <select> so it carries stable option values and is
          drivable via native events in agent-browser eval. */}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
        Time window (days)
        <select
          data-testid="globe-filter-window"
          value={String(filters.days)}
          onChange={(e) =>
            onChange({ days: Number(e.target.value) as 7 | 14 | 30 })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        >
          {WINDOW_OPTIONS.map((d) => (
            <option key={d} value={String(d)}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default EonetGlobe;
