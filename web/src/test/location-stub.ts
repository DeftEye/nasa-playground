import { vi } from 'vitest';

/**
 * Test helper: stubs `window.location` so that `href` assignment (used by
 * the axios 401 interceptor's redirect) is captured instead of triggering
 * jsdom's "Not implemented: navigation" path. Returns a restore function.
 *
 * The stub records `href` writes on the returned `hrefSet` mock so tests can
 * assert that the interceptor redirected to `/login` (VAL-FE-AUTH-010).
 */
export function stubLocation(initialPath = '/') {
  const hrefSet = vi.fn();
  const assign = vi.fn();
  const replace = vi.fn();
  const reload = vi.fn();

  let currentHref = `http://localhost${initialPath}`;

  const stub = {
    pathname: initialPath,
    search: '',
    hash: '',
    origin: 'http://localhost',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    protocol: 'http:',
    assign,
    replace,
    reload,
    toString: () => currentHref,
  } as unknown as Location;

  Object.defineProperty(stub, 'href', {
    configurable: true,
    get: () => currentHref,
    set: (value: string) => {
      hrefSet(value);
      currentHref = value;
    },
  });

  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: stub,
  });

  return {
    hrefSet,
    assign,
    replace,
    restore: () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    },
  };
}
