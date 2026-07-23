import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { server } from '../test/server';
import type { EonetMapEvent, EonetMapResponse } from '../types';

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

function mapResponse(events: EonetMapEvent[] = []): EonetMapResponse {
  return {
    window: { days: 30, from: '2026-06-23T00:00:00.000Z', to: '2026-07-23T00:00:00.000Z' },
    events,
  };
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

function GlobeTree() {
  return (
    <Routes>
      <Route path="/globe" element={<EonetGlobe />} />
    </Routes>
  );
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
// Tests
// ---------------------------------------------------------------------------

describe('EonetGlobe page shell', () => {
  it('renders globe-page root and fetches the map endpoint with days=30', async () => {
    const listSpy = { called: false };
    server.use(mapHandler(), listEndpointSpy(listSpy));

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
    server.use(mapHandler([MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]));

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
    server.use(mapHandler([MAP_EVENT_WILDFIRE]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    expect(screen.getAllByTestId('globe-event-point')).toHaveLength(1);
  });

  it('renders titles as JSX text (XSS-safe, no script injection)', async () => {
    server.use(mapHandler([MAP_EVENT_XSS]));

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
    server.use(mapHandler([MAP_EVENT_WILDFIRE, MAP_EVENT_STORM]));

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
    server.use(mapHandler([MAP_EVENT_WILDFIRE]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-canvas-container')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('globe-webgl-unavailable')).toBeNull();
    // DOM mirror still renders alongside the canvas.
    expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
  });

  it('shows a loading skeleton while the map query is pending', async () => {
    server.use(delayedMapHandler(500));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    // Shared skeleton testid while pending.
    await waitFor(() => {
      expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    });
    // No event mirrors or count yet while pending.
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);
  });

  it('shows error state + retry on 5xx and recovers on retry', async () => {
    let fail = true;
    server.use(
      http.get('/api/nasa/eonet/events/map', () => {
        if (fail) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(mapResponse([MAP_EVENT_WILDFIRE]), { status: 200 });
      }),
    );

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);

    // Recover on retry.
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
  });

  it('shows an empty state when the window has zero events', async () => {
    server.use(mapHandler([]));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('0');
    });
    expect(screen.queryAllByTestId('globe-event-point')).toHaveLength(0);
    // Shared empty-state component renders the "no events in this window" copy.
    expect(screen.getByTestId('empty-state').textContent).toContain('No events in this window');
  });

  it('does not call the legacy /events list endpoint on /globe', async () => {
    const listSpy = { called: false };
    server.use(mapHandler([MAP_EVENT_WILDFIRE]), listEndpointSpy(listSpy));

    renderWithProviders(<GlobeTree />, { routerProps: { initialEntries: ['/globe'] } });

    await waitFor(() => {
      expect(screen.getByTestId('globe-events-count').textContent).toBe('1');
    });
    // Give a tick for any stray call; the spy must remain uncalled.
    await new Promise((r) => setTimeout(r, 50));
    expect(listSpy.called).toBe(false);
  });
});
