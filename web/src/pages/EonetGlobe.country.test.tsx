import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { server } from '../test/server';
import type {
  EonetCategory,
  EonetMapEvent,
  EonetMapResponse,
} from '../types';
import type { FeatureCollection, Polygon } from 'geojson';

// Mock the GlobeView so the component test does not depend on three.js /
// WebGL under jsdom (library/eonet-globe.md). The mock still renders the
// `globe-canvas-container` testid with a fake <canvas> so the WebGL-up path
// is assertable.
vi.mock('../components/globe/GlobeView', () => ({
  GlobeView: () => (
    <div data-testid="globe-canvas-container">
      <canvas data-testid="mock-canvas" />
    </div>
  ),
}));

// Mock the synchronous WebGL guard so tests drive the WebGL-unavailable path
// deterministically (jsdom has no real WebGL). The side panel + DOM mirror
// must stay functional without WebGL (VAL-GCROSS-014).
vi.mock('../components/globe/webgl', () => ({
  webglAvailable: vi.fn(() => false),
}));

import { webglAvailable } from '../components/globe/webgl';
import { EonetGlobe } from './EonetGlobe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORIES: EonetCategory[] = [
  { id: 'wildfires', title: 'Wildfires', description: null },
  { id: 'severeStorms', title: 'Severe Storms', description: null },
  { id: 'volcanoes', title: 'Volcanoes', description: null },
];

/**
 * Synthetic countries fixture for component tests. Three squares:
 * - France (FRA): lng [-5,10], lat [41,51] — contains Paris [2.35, 48.85].
 * - USA (USA): lng [-125,-70], lat [25,50] — contains LA [-118.24, 34.05]
 *   and Florida [28.0, -80.0].
 * - Antarctica (ATA): lng [-180,180], lat [-90,-70] — contains no events.
 *
 * London [-0.12, 51.5] is OUTSIDE France (lat 51.5 > 51) and OUTSIDE the USA
 * (lng -0.12 > -70), so it is a clean exclusion case (VAL-COUNTRY-005).
 */
const COUNTRIES_FIXTURE: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { ADMIN: 'France', ADM0_A3: 'FRA' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-5, 41],
            [10, 41],
            [10, 51],
            [-5, 51],
            [-5, 41],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { ADMIN: 'United States of America', ADM0_A3: 'USA' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-125, 25],
            [-70, 25],
            [-70, 50],
            [-125, 50],
            [-125, 25],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { ADMIN: 'Antarctica', ADM0_A3: 'ATA' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -90],
            [180, -90],
            [180, -70],
            [-180, -70],
            [-180, -90],
          ],
        ],
      },
    },
  ],
};

const MAP_EVENT_PARIS: EonetMapEvent = {
  id: 'EONET_PARIS',
  title: 'Wildfire near Paris',
  status: 'open',
  date: '2026-07-20T00:00:00.000Z',
  lat: 48.85,
  lng: 2.35,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_PARIS',
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
};

const MAP_EVENT_LA: EonetMapEvent = {
  id: 'EONET_LA',
  title: 'Severe Storm over LA',
  status: 'closed',
  date: '2026-07-18T00:00:00.000Z',
  lat: 34.05,
  lng: -118.24,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_LA',
  categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
};

const MAP_EVENT_LON: EonetMapEvent = {
  id: 'EONET_LON',
  title: 'Volcano near London',
  status: 'open',
  date: '2026-07-19T00:00:00.000Z',
  lat: 51.5,
  lng: -0.12,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_LON',
  categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
};

const ALL_EVENTS = [MAP_EVENT_PARIS, MAP_EVENT_LA, MAP_EVENT_LON];

function mapResponse(events: EonetMapEvent[] = ALL_EVENTS, days = 30): EonetMapResponse {
  return {
    window: { days, from: '2026-06-23T00:00:00.000Z', to: '2026-07-23T00:00:00.000Z' },
    events,
  };
}

function categoriesHandler(cats: EonetCategory[] = CATEGORIES) {
  return http.get('/api/nasa/eonet/categories', () =>
    HttpResponse.json(cats, { status: 200 }),
  );
}

function mapHandler(events: EonetMapEvent[] = ALL_EVENTS) {
  return http.get('/api/nasa/eonet/events/map', () =>
    HttpResponse.json(mapResponse(events), { status: 200 }),
  );
}

function countriesHandler() {
  return http.get('/countries.geojson', () =>
    HttpResponse.json(COUNTRIES_FIXTURE, { status: 200 }),
  );
}

/** A map handler that filters server-side by category/status/days so the
 *  "filter change re-derives the panel" tests (VAL-COUNTRY-012/013/014) can
 *  observe the loaded set shrinking/growing. */
function filteringMapHandler() {
  return http.get('/api/nasa/eonet/events/map', ({ request }) => {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const days = Number(url.searchParams.get('days') ?? '30');
    let events = ALL_EVENTS;
    if (category && category !== 'all') {
      events = events.filter((e) => (e.categories ?? []).some((c) => c.id === category));
    }
    if (status && status !== 'all') {
      events = events.filter((e) => e.status === status);
    }
    // For the 7-day window test, drop the Paris event (dated 2026-07-20 is
    // within 7 days of 2026-07-23, so keep it); instead drop the oldest to
    // make the count change observable. Here simply return all in-window.
    return HttpResponse.json(mapResponse(events, days as 7 | 14 | 30), {
      status: 200,
    });
  });
}

/** A window-aware map handler for VAL-COUNTRY-011 / VAL-GCROSS-007: the
 *  loaded event set shrinks when the window narrows so the side panel of a
 *  selected country re-derives observably. For days=7 the Paris event is
 *  dropped (so France's panel empties); for days=14/30 all three events are
 *  returned. Category/status filters are also honored so the handler stays
 *  composable. */
function windowFilteringMapHandler() {
  return http.get('/api/nasa/eonet/events/map', ({ request }) => {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') ?? '30');
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    let events = days <= 7 ? ALL_EVENTS.filter((e) => e.id !== 'EONET_PARIS') : ALL_EVENTS;
    if (category && category !== 'all') {
      events = events.filter((e) => (e.categories ?? []).some((c) => c.id === category));
    }
    if (status && status !== 'all') {
      events = events.filter((e) => e.status === status);
    }
    return HttpResponse.json(mapResponse(events, days as 7 | 14 | 30), {
      status: 200,
    });
  });
}

function GlobeTree() {
  return (
    <Routes>
      <Route path="/globe" element={<EonetGlobe />} />
    </Routes>
  );
}

function defaultHandlers(mapEvents: EonetMapEvent[] = ALL_EVENTS) {
  return [categoriesHandler(), mapHandler(mapEvents), countriesHandler()];
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(webglAvailable).mockReturnValue(false);
});

afterEach(() => {
  vi.mocked(webglAvailable).mockReset();
  vi.mocked(webglAvailable).mockReturnValue(false);
  delete window.__selectCountry;
});

/** Waits for the countries dataset to load by probing for the first
 *  test-select button, then returns. */
async function waitForCountriesLoaded() {
  await waitFor(() => {
    expect(screen.getByTestId('globe-test-select-FRA')).toBeInTheDocument();
  });
}

/** Drives selection via the test hook and flushes React state. */
async function selectViaHook(input: Parameters<NonNullable<Window['__selectCountry']>>[0]) {
  act(() => {
    window.__selectCountry!(input);
  });
}

// ---------------------------------------------------------------------------
// VAL-COUNTRY-001: default state
// ---------------------------------------------------------------------------

describe('M11 country selection — default state', () => {
  it('globe-selected-country reads "none" and the side panel is absent', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    expect(screen.getByTestId('globe-selected-country').textContent).toBe('none');
    expect(screen.queryByTestId('globe-side-panel')).toBeNull();
    expect(screen.queryByTestId('globe-country-events')).toBeNull();
    expect(screen.queryByTestId('globe-country-events-count')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-002..005, VAL-COUNTRY-015: selecting a country with events
// ---------------------------------------------------------------------------

describe('M11 country selection — selecting a country with events', () => {
  it('window.__selectCountry("FRA") opens the panel, shows France, lists only in-country events', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    await selectViaHook('FRA');

    // VAL-COUNTRY-002: country name + panel present.
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    expect(screen.getByTestId('globe-country-events')).toBeInTheDocument();

    // VAL-COUNTRY-003: count matches the number of rows.
    const rows = screen.getAllByTestId('globe-country-event');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');

    // VAL-COUNTRY-004: the in-country event (Paris) appears.
    expect(rows[0].getAttribute('data-event-id')).toBe('EONET_PARIS');

    // VAL-COUNTRY-005: the out-of-country event (London) is NOT in the panel.
    expect(
      screen.queryByTestId('globe-country-events')?.querySelector(
        '[data-event-id="EONET_LON"]',
      ),
    ).toBeNull();
    expect(
      screen.queryByTestId('globe-country-events')?.querySelector(
        '[data-event-id="EONET_LA"]',
      ),
    ).toBeNull();
  });

  it('the out-of-country London event is plotted but absent from the France panel', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    // London is in the plotted mirror.
    expect(
      screen
        .getAllByTestId('globe-event-point')
        .some((p) => p.getAttribute('data-event-id') === 'EONET_LON'),
    ).toBe(true);

    await selectViaHook('FRA');

    // ...but absent from the country panel.
    expect(
      screen.queryByTestId('globe-country-events')?.querySelector(
        '[data-event-id="EONET_LON"]',
      ),
    ).toBeNull();
  });

  it('clicking the hidden globe-test-select-USA button selects the USA equivalently', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    // VAL-COUNTRY-015: hidden test-select button routes through the same
    // handler as the hook / onPolygonClick.
    fireEvent.click(screen.getByTestId('globe-test-select-USA'));

    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe(
        'United States of America',
      );
    });
    const rows = screen.getAllByTestId('globe-country-event');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-event-id')).toBe('EONET_LA');
  });

  it('window.__selectCountry accepts a full GeoJSON feature object', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    const franceFeature = COUNTRIES_FIXTURE.features[0];
    await selectViaHook(franceFeature as never);

    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getAllByTestId('globe-country-event')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-006: country with no matching events
// ---------------------------------------------------------------------------

describe('M11 country selection — country with no events', () => {
  it('shows globe-country-empty ("no events in this country") distinct from globe-empty', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    await selectViaHook('ATA');

    expect(screen.getByTestId('globe-selected-country').textContent).toBe('Antarctica');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    expect(screen.getByTestId('globe-country-empty')).toBeInTheDocument();
    // Distinct copy from the window-empty state.
    expect(screen.getByTestId('globe-country-empty').textContent).toContain(
      'No events in this country',
    );
    expect(screen.getByTestId('globe-country-empty').textContent).not.toContain(
      'No events in this window',
    );
    expect(screen.getByTestId('globe-country-events-count').textContent).toBe('0');
    expect(screen.queryAllByTestId('globe-country-event')).toHaveLength(0);
    // The window-empty state is NOT shown (events exist globally).
    expect(screen.queryByTestId('globe-empty')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-007: close side panel resets to "none"
// ---------------------------------------------------------------------------

describe('M11 country selection — closing the panel', () => {
  it('globe-side-panel-close resets selected country to "none" and clears the panel', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('globe-side-panel-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('globe-side-panel')).toBeNull();
    });
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('none');
    expect(screen.queryByTestId('globe-country-events')).toBeNull();
    expect(screen.queryByTestId('globe-country-events-count')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-008 / VAL-COUNTRY-009 / VAL-GCROSS-010: event detail + safe link
// ---------------------------------------------------------------------------

describe('M11 country selection — event detail and external link', () => {
  it('clicking a globe-event-point opens globe-event-detail with the title and a safe external link', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getAllByTestId('globe-event-point').length).toBe(3);
    });

    const parisPoint = screen
      .getAllByTestId('globe-event-point')
      .find((p) => p.getAttribute('data-event-id') === 'EONET_PARIS')!;
    fireEvent.click(parisPoint);

    await waitFor(() => {
      expect(screen.getByTestId('globe-event-detail')).toBeInTheDocument();
    });

    // Title is rendered as text.
    expect(screen.getByTestId('globe-event-detail').textContent).toContain(
      'Wildfire near Paris',
    );

    // Safe external link (VAL-COUNTRY-009).
    const link = screen.getByTestId('globe-event-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_PARIS',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    const rel = link.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    // No token / api_key / secret in the URL.
    expect(link.getAttribute('href')).not.toMatch(/api_key|token|key|discord/i);
    expect(link.getAttribute('href')).toMatch(/^https:\/\/eonet\.gsfc\.nasa\.gov\//);
  });

  it('clicking a globe-country-event row also opens the event detail', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getAllByTestId('globe-country-event').length).toBe(1);
    });

    fireEvent.click(screen.getByTestId('globe-country-event'));

    await waitFor(() => {
      expect(screen.getByTestId('globe-event-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('globe-event-link')).toBeInTheDocument();
  });

  it('closing the event detail returns to the globe without losing the selection', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('FRA');
    fireEvent.click(screen.getByTestId('globe-country-event'));
    await waitFor(() => {
      expect(screen.getByTestId('globe-event-detail')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('globe-event-detail-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('globe-event-detail')).toBeNull();
    });
    // Selection persists.
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    // Plotted events persist.
    expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
  });

  it('renders globe-event-link inert (no href) when the link is not https:// (misc-globe-polish)', async () => {
    // Event with a non-https (javascript:) link — must NOT become a live
    // navigation target. The fixture overrides Paris's link.
    const malicious = {
      ...MAP_EVENT_PARIS,
      link: 'javascript:alert(1)',
    };
    server.use(categoriesHandler(), mapHandler([malicious]), countriesHandler());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getAllByTestId('globe-event-point').length).toBe(1);
    });

    fireEvent.click(screen.getByTestId('globe-event-point'));

    await waitFor(() => {
      expect(screen.getByTestId('globe-event-detail')).toBeInTheDocument();
    });

    // The link element is rendered inert: no href attribute, not an <a>.
    const link = screen.getByTestId('globe-event-link');
    expect(link.tagName).not.toBe('A');
    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('target')).toBeNull();
    // Marked non-interactive for assistive tech.
    expect(link.getAttribute('aria-disabled')).toBe('true');
    // The malicious payload is not present as a navigable href anywhere.
    expect(link.outerHTML).not.toContain('javascript:alert(1)');
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-010 / VAL-GCROSS-009: selecting a different country replaces
// the panel; round-trip does not leak stale state.
// ---------------------------------------------------------------------------

describe('M11 country selection — replacing and round-tripping', () => {
  it('selecting a different country replaces the panel contents with no stale rows', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();

    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_PARIS']);

    // Select a different country.
    await selectViaHook('USA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe(
        'United States of America',
      );
    });

    const rows = screen.getAllByTestId('globe-country-event');
    expect(rows.map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_LA']);
    // No stale France row remains.
    expect(
      rows.some((r) => r.getAttribute('data-event-id') === 'EONET_PARIS'),
    ).toBe(false);
    expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
  });

  it('close → select B → re-select A restores A without stale state (VAL-GCROSS-009)', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();

    // A = France.
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    });

    // Close.
    fireEvent.click(screen.getByTestId('globe-side-panel-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('globe-side-panel')).toBeNull();
    });
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('none');

    // B = USA.
    await selectViaHook('USA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe(
        'United States of America',
      );
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_LA']);

    // Re-select A.
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_PARIS']);
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-012 / VAL-COUNTRY-013 / VAL-COUNTRY-014: filter change while
// a country is selected re-derives the panel from the new loaded set.
// ---------------------------------------------------------------------------

describe('M11 country selection — re-derives on filter change', () => {
  it('changing category while France is selected re-derives the panel (VAL-COUNTRY-012)', async () => {
    server.use(categoriesHandler(), filteringMapHandler(), countriesHandler());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_PARIS']);

    // Filter to severeStorms — Paris is wildfires, so France panel empties.
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'severeStorms' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    // Selection persists (VAL-COUNTRY-012).
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    // Panel re-derived: no wildfires event in France under the new filter.
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-country-event')).toHaveLength(0);
    expect(screen.getByTestId('globe-country-empty')).toBeInTheDocument();

    // Reset to all — France panel repopulates.
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'all' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_PARIS']);
  });

  it('changing status while France is selected re-derives the panel (VAL-COUNTRY-013)', async () => {
    server.use(categoriesHandler(), filteringMapHandler(), countriesHandler());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });

    // Paris is open; filter to closed -> France panel empties.
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'closed' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('0');
    });
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    expect(screen.getByTestId('globe-country-empty')).toBeInTheDocument();

    // Back to open -> France panel has Paris again.
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'open' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id'))).toEqual(['EONET_PARIS']);
  });
});

// ---------------------------------------------------------------------------
// VAL-COUNTRY-019: side-panel IDs are a subset of plotted point IDs.
// VAL-GCROSS-008: category consistency between point and side-panel row.
// ---------------------------------------------------------------------------

describe('M11 country selection — parity with the plotted mirror', () => {
  it('country-event IDs are a subset of plotted globe-event-point IDs', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('USA');

    const pointIds = new Set(
      screen
        .getAllByTestId('globe-event-point')
        .map((p) => p.getAttribute('data-event-id')),
    );
    const rowIds = screen
      .getAllByTestId('globe-country-event')
      .map((r) => r.getAttribute('data-event-id'));
    expect(rowIds.every((id) => pointIds.has(id!))).toBe(true);
    expect(screen.getByTestId('globe-country-events-count').textContent).toBe(
      String(rowIds.length),
    );
  });

  it('the category matches between a globe-event-point and its globe-country-event row (VAL-GCROSS-008)', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await selectViaHook('FRA');

    const point = screen
      .getAllByTestId('globe-event-point')
      .find((p) => p.getAttribute('data-event-id') === 'EONET_PARIS')!;
    const row = screen
      .getAllByTestId('globe-country-event')
      .find((r) => r.getAttribute('data-event-id') === 'EONET_PARIS')!;
    expect(point.getAttribute('data-category')).toBe(row.getAttribute('data-category'));
    expect(point.getAttribute('data-status')).toBe(row.getAttribute('data-status'));
  });
});

// ---------------------------------------------------------------------------
// misc-globe-polish: window-change re-derivation with a selection active
// (VAL-COUNTRY-011 / VAL-GCROSS-007).
// ---------------------------------------------------------------------------

describe('misc-globe-polish — window change re-derives the side panel (VAL-COUNTRY-011 / VAL-GCROSS-007)', () => {
  it('narrowing the window while France is selected drops Paris from the panel; selection persists', async () => {
    server.use(categoriesHandler(), windowFilteringMapHandler(), countriesHandler());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    // days=30 default → all 3 events loaded; Paris is in France.
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(
      screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id')),
    ).toEqual(['EONET_PARIS']);

    // Narrow the window to 7 days — the handler drops Paris, so the loaded
    // set shrinks to 2 (LA + London) and the globe count updates.
    fireEvent.change(screen.getByTestId('globe-filter-window'), {
      target: { value: '7' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });
    // VAL-COUNTRY-011: selection persists across the window change.
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('France');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    // VAL-GCROSS-007: the panel re-derives from the new loaded set — Paris
    // is gone, so France's panel empties.
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-country-event')).toHaveLength(0);
    expect(screen.getByTestId('globe-country-empty')).toBeInTheDocument();
    // Paris is no longer plotted at all.
    expect(
      screen
        .getAllByTestId('globe-event-point')
        .some((p) => p.getAttribute('data-event-id') === 'EONET_PARIS'),
    ).toBe(false);

    // Widen back to 30 — Paris returns and France's panel repopulates.
    fireEvent.change(screen.getByTestId('globe-filter-window'), {
      target: { value: '30' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(
      screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id')),
    ).toEqual(['EONET_PARIS']);
  });
});

// ---------------------------------------------------------------------------
// misc-globe-polish: combined category + status intersection with a
// selection active (VAL-GCROSS-006).
// ---------------------------------------------------------------------------

describe('misc-globe-polish — combined category + status intersection with a selection (VAL-GCROSS-006)', () => {
  it('category+status intersection is applied across the globe and the USA side panel', async () => {
    server.use(categoriesHandler(), filteringMapHandler(), countriesHandler());

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    await waitForCountriesLoaded();
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    // USA contains LA (severeStorms, closed).
    await selectViaHook('USA');
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(
      screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id')),
    ).toEqual(['EONET_LA']);

    // Intersection: category=severeStorms AND status=closed → only LA
    // matches both. Globe count and USA panel both reflect the intersection.
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'severeStorms' },
    });
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'closed' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-event-point')).toHaveLength(1);
    expect(screen.getAllByTestId('globe-event-point')[0].getAttribute('data-category')).toBe('severeStorms');
    expect(screen.getAllByTestId('globe-event-point')[0].getAttribute('data-status')).toBe('closed');
    // Selection persists; panel re-derives to the intersection (still LA).
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('United States of America');
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(
      screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id')),
    ).toEqual(['EONET_LA']);

    // Flip category to wildfires (LA is severeStorms) — the intersection is
    // now empty, so the globe empties AND the USA panel empties.
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'wildfires' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('United States of America');
    expect(screen.getByTestId('globe-side-panel')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-country-event')).toHaveLength(0);
    expect(screen.getByTestId('globe-country-empty')).toBeInTheDocument();

    // Reset both filters — globe + USA panel restore.
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'all' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-country-events-count').textContent).toBe('1');
    });
    expect(
      screen.getAllByTestId('globe-country-event').map((r) => r.getAttribute('data-event-id')),
    ).toEqual(['EONET_LA']);
  });
});

// ---------------------------------------------------------------------------
// misc-globe-polish: selection UI absent / non-interactive in the map-error
// path (VAL-COUNTRY-020).
// ---------------------------------------------------------------------------

describe('misc-globe-polish — selection UI absent in the map-error path (VAL-COUNTRY-020)', () => {
  it('when the map endpoint errors, the side panel + test-select buttons are absent and the hook is non-interactive', async () => {
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
      countriesHandler(),
    );

    renderWithProviders(<GlobeTree />, {
      routerProps: { initialEntries: ['/globe'] },
    });

    // Error state renders; the data-dependent block (globe area, mirror,
    // side panel, hidden test-select buttons) does NOT render.
    await waitFor(() => {
      expect(screen.getByTestId('globe-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('globe-error-retry')).toBeInTheDocument();

    // Default selected country reads "none" with no panel.
    expect(screen.getByTestId('globe-selected-country').textContent).toBe('none');
    expect(screen.queryByTestId('globe-side-panel')).toBeNull();
    expect(screen.queryByTestId('globe-country-events')).toBeNull();
    expect(screen.queryByTestId('globe-country-events-count')).toBeNull();

    // The hidden test-select buttons are NOT rendered in the error path, so
    // selection is not drivable from the DOM.
    expect(screen.queryByTestId('globe-test-select-FRA')).toBeNull();
    expect(screen.queryByTestId('globe-test-select-USA')).toBeNull();

    // Graceful degradation: even if the window.__selectCountry hook is
    // invoked, no side panel opens (the data-dependent block is gated on
    // mapQuery.data, which is absent on error). The selection UI stays
    // non-interactive.
    await selectViaHook('FRA');
    await waitFor(() => {
      expect(screen.queryByTestId('globe-side-panel')).toBeNull();
    });
    expect(screen.queryByTestId('globe-country-events')).toBeNull();
    expect(screen.queryByTestId('globe-country-events-count')).toBeNull();
    // The error UI is still the dominant state.
    expect(screen.getByTestId('globe-error')).toBeInTheDocument();
  });
});
