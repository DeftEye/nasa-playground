import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// MSW 2 server lifecycle: start before all tests, reset handlers between
// tests, and close after all tests (architecture §6 / MSW 2 docs).
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // Clear localStorage between tests so auth state doesn't leak.
  localStorage.clear();
});
afterAll(() => server.close());
