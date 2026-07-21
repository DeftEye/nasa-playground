import nock from 'nock';

/**
 * Clears all pending/active nock interceptors so each test starts from a clean
 * HTTP-mock slate. Local TCP connections (Postgres) are unaffected because nock
 * only intercepts the http/https modules, but we keep localhost explicitly
 * allowed for any supertest-driven traffic.
 */
export function nockReset(): void {
  nock.cleanAll();
  nock.abortPendingRequests();
  if (!nock.isActive()) {
    nock.activate();
  }
  nock.enableNetConnect(
    (host) => host.includes('127.0.0.1') || host.includes('localhost'),
  );
}
