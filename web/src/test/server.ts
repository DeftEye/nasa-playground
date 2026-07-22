import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

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
  http.all('*', () => {
    return HttpResponse.json(
      { error: 'NO HANDLER REGISTERED' },
      { status: 500 },
    );
  }),
);
