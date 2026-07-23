import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

/**
 * Minimal valid GeoJSON FeatureCollection returned by the default
 * `/countries.geojson` handler. The bundled countries dataset is loaded on
 * every `<EonetGlobe>` render (the `countriesQuery` is always enabled since
 * M11 — country selection must work in the headless/WebGL-off DOM path, see
 * `library/eonet-globe.md`). Component tests that exercise country
 * selection register their own richer fixture via `server.use(...)` (which
 * takes precedence over this default); this default simply prevents the
 * always-on countries fetch from hitting the catch-all 500 in tests that
 * render the page but do not assert country selection (M10 + M11 hygiene).
 */
const DEFAULT_COUNTRIES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * `defaultHandlers` — the baseline MSW handlers that survive
 * `server.resetHandlers()` (they are part of the initial handler list).
 * Tests add per-test handlers on top via `server.use(...)`; MSW matches
 * most-recently-added handlers first, so a test-supplied
 * `/countries.geojson` handler shadows this default.
 *
 * Currently contains:
 * - `GET /countries.geojson` → minimal valid FeatureCollection (see above).
 */
export const defaultHandlers = [
  http.get('/countries.geojson', () =>
    HttpResponse.json(DEFAULT_COUNTRIES, { status: 200 }),
  ),
];

/**
 * MSW 2 server for component-level test mocking (architecture §6).
 *
 * This server boots in every Vitest file via the setup file. Individual tests
 * can override handlers with `server.use(...)` and reset between tests with
 * `server.resetHandlers()` (called in the setup file's `afterEach`).
 *
 * Catch-all (M5 polish): returns 500 'NO HANDLER REGISTERED' for any
 * unhandled request so tests fail loud instead of silently 404-ing. Tests
 * should register specific handlers via `server.use(...)`; any request that
 * falls through to this handler indicates a missing mock.
 */
export const server = setupServer(
  ...defaultHandlers,
  http.all('*', () => {
    return HttpResponse.json(
      { error: 'NO HANDLER REGISTERED' },
      { status: 500 },
    );
  }),
);
