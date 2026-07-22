import { describe, it, expect } from 'vitest';

/**
 * Trivial smoke test verifying the Vitest + jsdom + MSW configuration loads
 * correctly. The MSW server boots via the setup file's `beforeAll` hook; if
 * it fails to start, this test file would error during setup.
 */
describe('smoke test', () => {
  it('trivial assertion passes', () => {
    expect(1).toBe(1);
  });

  it('MSW server boots in test environment', () => {
    // The setup file's beforeAll starts the MSW server. If it failed, this
    // test would not run. We assert a basic DOM API is available (jsdom).
    expect(document).toBeDefined();
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement);
  });
});
