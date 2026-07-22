import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

/**
 * MSW 2 server for component-level test mocking (architecture §6).
 *
 * This server boots in every Vitest file via the setup file. Individual tests
 * can override handlers with `server.use(...)` and reset between tests with
 * `server.resetHandlers()` (called in the setup file's `afterEach`).
 *
 * Default handlers: none — tests provide their own handlers. The server still
 * boots so the "MSW server boots in tests" expectation is verified.
 */
export const server = setupServer(
  // A catch-all that passes through unhandled requests to the real network.
  // Tests should register specific handlers via `server.use(...)`.
  http.all('*', () => {
    // Default: let unhandled requests pass through.
    // Tests that need to mock should override with server.use(...).
    return HttpResponse.json(
      { error: 'MSW: no handler matched this request' },
      { status: 404 },
    );
  }),
);
