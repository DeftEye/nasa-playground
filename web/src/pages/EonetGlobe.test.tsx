import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { server } from '../test/server';
import type { EonetCategory, EonetMapEvent, EonetMapResponse } from '../types';

// Mock the GlobeView so the component test does not depend on three.js /
// WebGL under jsdom (library/eonet-globe.md: "if react-globe.gl misbehaves
// under jsdom, mock the GlobeView child component and assert the DOM
// mirror"). The mock still renders the `globe-canvas-container` testid with
// a fake <canvas> so the WebGL-up path is assertable.
vi.mock('../components/globe/GlobeView', () => ({
  GlobeView: () => (
    <div data-testid="globe-canvas-container">
      <canvas data-testid="mock-canvas" />
    </div>
  ),
}));

// Mock the synchronous WebGL guard so tests can drive both the available and
// unavailable paths deterministically (jsdom has no real WebGL).
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

const MAP_EVENT_WILDFIRE: EonetMapEvent = {
  id: 'EONET_1',
  title: 'Wildfire One',
  status: 'open',
  date: '2026-07-20T00:00:00.000Z',
  lat: 34.05,
  lng: -118.24,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
};

const MAP_EVENT_STORM: EonetMapEvent = {
  id: 'EONET_2',
  title: 'Severe Storm Two',
  status: 'closed',
  date: '2026-07-18T00:00:00.000Z',
  lat: 28.0,
  lng: -80.0,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2',
  categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
};

const MAP_EVENT_XSS: EonetMapEvent = {
  id: 'EONET_3',
  title: '<script>alert(1)</script>',
  status: 'open',
  date: '2026-07-19T00:00:00.000Z',
  lat: 10.0,
  lng: 10.0,
  link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_3',
  categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
};

function mapResponse(events: EonetMapEvent[] = [], days = 30): EonetMapResponse {
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

function mapHandler(events: EonetMapEvent[] = [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]) {
  return http.get('/api/nasa/eonet/events/map', () =>
    HttpResponse.json(mapResponse(events), { status: 200 }),
  );
}

function delayedMapHandler(ms = 500, events: EonetMapEvent[] = [MAP_EVENT_WILDFIRE]) {
  return http.get('/api/nasa/eonet/events/map', async () => {
    await delay(ms);
    return HttpResponse.json(mapResponse(events), { status: 200 });
  });
}

/**
 * A handler that records any call to the legacy `/events` LIST endpoint so
 * tests can assert it is NEVER called on /globe (VAL-GLOBE-026).
 */
function listEndpointSpy(spy: { called: boolean }) {
  return http.get('/api/nasa/eonet/events', () => {
    spy.called = true;
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }, { status: 200 });
  });
}

/** Records the query-string of every map request so filter tests can assert
 *  the params the frontend sent (days/category/status). */
function mapRequestRecorder(calls: { url: string }[]) {
  return http.get('/api/nasa/eonet/events/map', ({ request }) => {
    calls.push({ url: request.url });
    return HttpResponse.json(mapResponse([MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]), {
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

/** Default handlers used by every test (categories + map). Tests can override
 *  the map handler via `server.use(...)`. */
function defaultHandlers(mapEvents: EonetMapEvent[] = [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]) {
  return [categoriesHandler(), mapHandler(mapEvents)];
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(webglAvailable).mockReturnValue(false);
});

afterEach(() => {
  vi.mocked(webglAvailable).mockReset();
  vi.mocked(webglAvailable).mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Page shell + DOM mirror (M10 part 1 regression + new testids)
// ---------------------------------------------------------------------------

describe('EonetGlobe page shell', () => {
  it('renders globe-page root and fetches the map endpoint with days=30', async () => {
    const listSpy = { called: false };
    server.use(...defaultHandlers(), listEndpointSpy(listSpy));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-page')).toBeInTheDocument();
    });

    // Count + mirror render after the map resolves.
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });
    expect(screen.getAllByTestId('globe-event-point')).toHaveLength(2);

    // The legacy list endpoint is never called on /globe (VAL-GLOBE-026).
    await waitFor(() => {
      expect(listSpy.called).toBe(false);
    });
  });

  it('renders one globe-event-point per plotted event with data-* attributes', async () => {
    server.use(...defaultHandlers([MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getAllByTestId('globe-event-point')).toHaveLength(2);
    });

    const points = screen.getAllByTestId('globe-event-point');
    const byId = new Map(points.map((p) => [p.getAttribute('data-event-id'), p]));

    const fire = byId.get('EONET_1')!;
    expect(fire.getAttribute('data-category')).toBe('wildfires');
    expect(fire.getAttribute('data-status')).toBe('open');
    expect(fire.getAttribute('data-title')).toBe('Wildfire One');

    const storm = byId.get('EONET_2')!;
    expect(storm.getAttribute('data-category')).toBe('severeStorms');
    expect(storm.getAttribute('data-status')).toBe('closed');
    expect(storm.getAttribute('data-title')).toBe('Severe Storm Two');
  });

  it('globe-events-count equals the number of plotted events', async () => {
    server.use(...defaultHandlers([MAP_EVENT_WILDFIRE]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-event-point')).toHaveLength(1);
  });

  it('renders titles as JSX text (XSS-safe, no script injection)', async () => {
    server.use(...defaultHandlers([MAP_EVENT_XSS]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getAllByTestId('globe-event-point')).toHaveLength(1);
    });

    const point = screen.getByTestId('globe-event-point');
    // The malicious title appears as literal text content, not as an element.
    expect(point.getAttribute('data-title')).toBe('<script>alert(1)</script>');
    expect(point.textContent).toContain('<script>alert(1)</script>');
    // No <script> element was injected into the document from the globe.
    expect(document.querySelector('script[data-injected]')).toBeNull();
  });

  it('shows globe-webgl-unavailable and keeps the DOM mirror when WebGL is down', async () => {
    server.use(...defaultHandlers([MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-webgl-unavailable')).toBeInTheDocument();
    });
    // canvas-container is absent in the WebGL-down state (VAL-GLOBE-022).
    expect(screen.queryByTestId('globe-canvas-container')).toBeNull();
    // The DOM mirror still renders (VAL-GLOBE-023).
    expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    expect(screen.getAllByTestId('globe-event-point')).toHaveLength(2);
  });

  it('mounts globe-canvas-container when WebGL is available', async () => {
    vi.mocked(webglAvailable).mockReturnValue(true);
    server.use(...defaultHandlers([MAP_EVENT_WILDFIRE]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-canvas-container')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('globe-webgl-unavailable')).toBeNull();
    // DOM mirror still renders alongside the canvas.
    expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
  });

  it('shows globe-skeleton while the map query is pending and no points yet', async () => {
    server.use(categoriesHandler(), delayedMapHandler(500));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    // Dedicated globe-skeleton testid while pending (VAL-GLOBE-018).
    await waitFor(() => {
      expect(screen.getByTestId('globe-skeleton')).toBeInTheDocument();
    });
    // No event mirrors or count yet while pending.
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);
  });

  it('shows globe-error + globe-error-retry on 5xx and recovers on retry', async () => {
    let fail = true;
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', () => {
        if (fail) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(mapResponse([MAP_EVENT_WILDFIRE]), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('globe-error-retry')).toBeInTheDocument();
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);

    // Recover on retry (VAL-GLOBE-021).
    fail = false;
    fireEvent.click(screen.getByTestId('globe-error-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    expect(screen.queryByTestId('globe-error')).toBeNull();
  });

  it('shows globe-empty when the window has zero events (distinct from error)', async () => {
    server.use(...defaultHandlers([]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);
    // Dedicated globe-empty testid with window-specific copy (VAL-GLOBE-019).
    expect(screen.getByTestId('globe-empty').textContent).toContain('No events in this window');
    // No error UI in the empty state.
    expect(screen.queryByTestId('globe-error')).toBeNull();
  });

  it('does not call the legacy /events list endpoint on /globe', async () => {
    const listSpy = { called: false };
    server.use(...defaultHandlers([MAP_EVENT_WILDFIRE]), listEndpointSpy(listSpy));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    // Give a tick for any stray call; the spy must remain uncalled.
    await new Promise((r) => setTimeout(r, 50));
    expect(listSpy.called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Filter bar (M10 part 2 — VAL-GLOBE-010..017, VAL-GLOBE-024)
// ---------------------------------------------------------------------------

describe('EonetGlobe filter bar', () => {
  it('renders the three filter controls with stable option values', async () => {
    server.use(...defaultHandlers());

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });

    // Category select has 'all' + one option per category (VAL-GLOBE-010).
    const catSelect = screen.getByTestId('globe-filter-category') as HTMLSelectElement;
    const catValues = Array.from(catSelect.options).map((o) => o.value);
    expect(catValues).toEqual(expect.arrayContaining(['all', 'wildfires', 'severeStorms', 'volcanoes']));
    expect(catSelect.value).toBe('all');

    // Status select has exactly all/open/closed, default 'all' (VAL-GLOBE-011).
    const statusSelect = screen.getByTestId('globe-filter-status') as HTMLSelectElement;
    const statusValues = Array.from(statusSelect.options).map((o) => o.value);
    expect(statusValues.sort()).toEqual(['all', 'closed', 'open']);
    expect(statusSelect.value).toBe('all');

    // Window select offers 7/14/30, default '30' (VAL-GLOBE-012).
    const windowSelect = screen.getByTestId('globe-filter-window') as HTMLSelectElement;
    const windowValues = Array.from(windowSelect.options).map((o) => o.value);
    expect(windowValues).toEqual(['7', '14', '30']);
    expect(windowSelect.value).toBe('30');
  });

  it('initial map request uses days=30 with no category/status params', async () => {
    const calls: { url: string }[] = [];
    server.use(categoriesHandler(), mapRequestRecorder(calls));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const first = new URL(calls[0].url);
    expect(first.searchParams.get('days')).toBe('30');
    expect(first.searchParams.get('category')).toBeNull();
    expect(first.searchParams.get('status')).toBeNull();
  });

  it('changing category refetches with the category param and updates the plotted set', async () => {
    const calls: { url: string }[] = [];
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', ({ request }) => {
        calls.push({ url: request.url });
        const url = new URL(request.url);
        const category = url.searchParams.get('category');
        const pool = [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM];
        const events =
          category && category !== 'all'
            ? pool.filter((e) => (e.categories ?? []).some((c) => c.id === category))
            : pool;
        return HttpResponse.json(mapResponse(events), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });

    // Change category to wildfires (VAL-GLOBE-013).
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'wildfires' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    const points = screen.getAllByTestId('globe-event-point');
    expect(points).toHaveLength(1);
    expect(points[0].getAttribute('data-category')).toBe('wildfires');

    // The last map request carried category=wildfires.
    const last = new URL(calls[calls.length - 1].url);
    expect(last.searchParams.get('category')).toBe('wildfires');
  });

  it('changing status refetches with the status param and updates the plotted set', async () => {
    const calls: { url: string }[] = [];
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', ({ request }) => {
        calls.push({ url: request.url });
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const pool = [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM];
        const events =
          status && status !== 'all' ? pool.filter((e) => e.status === status) : pool;
        return HttpResponse.json(mapResponse(events), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });

    // Change status to open (VAL-GLOBE-014).
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'open' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    let points = screen.getAllByTestId('globe-event-point');
    expect(points).toHaveLength(1);
    expect(points[0].getAttribute('data-status')).toBe('open');
    expect(new URL(calls[calls.length - 1].url).searchParams.get('status')).toBe('open');

    // Change status to closed.
    fireEvent.change(screen.getByTestId('globe-filter-status'), {
      target: { value: 'closed' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    points = screen.getAllByTestId('globe-event-point');
    expect(points[0].getAttribute('data-status')).toBe('closed');
    expect(new URL(calls[calls.length - 1].url).searchParams.get('status')).toBe('closed');
  });

  it('changing the window refetches with the new days param (VAL-GLOBE-015)', async () => {
    const calls: { url: string }[] = [];
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', ({ request }) => {
        calls.push({ url: request.url });
        const url = new URL(request.url);
        const days = Number(url.searchParams.get('days') ?? '30');
        // Return a single event for 7-day, two for wider windows, so the
        // count change is observable.
        const events = days <= 7 ? [MAP_EVENT_WILDFIRE] : [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM];
        return HttpResponse.json(mapResponse(events, days as 7 | 14 | 30), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });
    expect(new URL(calls[0].url).searchParams.get('days')).toBe('30');

    // Change window to 7.
    fireEvent.change(screen.getByTestId('globe-filter-window'), {
      target: { value: '7' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    expect(new URL(calls[calls.length - 1].url).searchParams.get('days')).toBe('7');
  });

  it('applies combined category + status + window filters together (VAL-GLOBE-016)', async () => {
    const calls: { url: string }[] = [];
    const pool: EonetMapEvent[] = [
      { ...MAP_EVENT_WILDFIRE, status: 'open', categories: [{ id: 'wildfires', title: 'Wildfires' }] },
      { ...MAP_EVENT_WILDFIRE, id: 'EONET_4', status: 'closed', categories: [{ id: 'wildfires', title: 'Wildfires' }] },
      { ...MAP_EVENT_STORM, status: 'open', categories: [{ id: 'severeStorms', title: 'Severe Storms' }] },
    ];
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', ({ request }) => {
        calls.push({ url: request.url });
        const url = new URL(request.url);
        const days = Number(url.searchParams.get('days') ?? '30');
        const category = url.searchParams.get('category');
        const status = url.searchParams.get('status');
        let events = pool;
        if (category && category !== 'all') {
          events = events.filter((e) => (e.categories ?? []).some((c) => c.id === category));
        }
        if (status && status !== 'all') {
          events = events.filter((e) => e.status === status);
        }
        return HttpResponse.json(mapResponse(events, days as 7 | 14 | 30), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('3');
    });

    // Set all three: category=wildfires, status=open, window=14.
    fireEvent.change(screen.getByTestId('globe-filter-category'), { target: { value: 'wildfires' } });
    fireEvent.change(screen.getByTestId('globe-filter-status'), { target: { value: 'open' } });
    fireEvent.change(screen.getByTestId('globe-filter-window'), { target: { value: '14' } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    const points = screen.getAllByTestId('globe-event-point');
    expect(points).toHaveLength(1);
    expect(points[0].getAttribute('data-category')).toBe('wildfires');
    expect(points[0].getAttribute('data-status')).toBe('open');

    const last = new URL(calls[calls.length - 1].url);
    expect(last.searchParams.get('days')).toBe('14');
    expect(last.searchParams.get('category')).toBe('wildfires');
    expect(last.searchParams.get('status')).toBe('open');
  });

  it('filters remain functional in the WebGL-unavailable state (VAL-GLOBE-024)', async () => {
    // WebGL is mocked false by default (beforeEach).
    const calls: { url: string }[] = [];
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events/map', ({ request }) => {
        calls.push({ url: request.url });
        const url = new URL(request.url);
        const category = url.searchParams.get('category');
        const pool = [MAP_EVENT_WILDFIRE, MAP_EVENT_STORM];
        const events =
          category && category !== 'all'
            ? pool.filter((e) => (e.categories ?? []).some((c) => c.id === category))
            : pool;
        return HttpResponse.json(mapResponse(events), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-webgl-unavailable')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('2');
    });

    // Filter bar is present and interactive even without WebGL.
    expect(screen.getByTestId('globe-filter-category')).toBeInTheDocument();
    expect(screen.getByTestId('globe-filter-status')).toBeInTheDocument();
    expect(screen.getByTestId('globe-filter-window')).toBeInTheDocument();

    // Changing category updates the plotted set + count (VAL-GLOBE-024).
    fireEvent.change(screen.getByTestId('globe-filter-category'), {
      target: { value: 'severeStorms' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    const points = screen.getAllByTestId('globe-event-point');
    expect(points).toHaveLength(1);
    expect(points[0].getAttribute('data-category')).toBe('severeStorms');
    expect(new URL(calls[calls.length - 1].url).searchParams.get('category')).toBe('severeStorms');

    // Changing window refetches even without WebGL.
    fireEvent.change(screen.getByTestId('globe-filter-window'), {
      target: { value: '7' },
    });
    await waitFor(() => {
      expect(new URL(calls[calls.length - 1].url).searchParams.get('days')).toBe('7');
    });
  });
});
