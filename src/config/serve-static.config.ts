import { ServeStaticModuleOptions } from '@nestjs/serve-static';

/**
 * Builds the `ServeStaticModule` options that serve the built SPA
 * (`web/dist`) in production. Used by `maybeServeStatic()` in `app.module.ts`,
 * which only mounts the module when `NODE_ENV === 'production' && web/dist`
 * exists (dev uses Vite on :5173; tests keep static serving off).
 *
 * SPA deep-link fallback (VAL-PRODFIX2-001 / VAL-PRODFIX2-002):
 * `@nestjs/serve-static` v5's default `renderPath` (`{*any}`) registers a
 * catch-all GET handler that sends `index.html` for any request that is NOT
 * excluded and did not resolve to a real static asset. Client-side routes
 * such as `/apod/archive`, `/globe`, `/login` therefore return the SPA shell
 * (200 text/html) on refresh / direct navigation instead of a JSON 404, so
 * React Router can render the right page.
 *
 * IMPORTANT: two non-obvious details make the SPA fallback actually work under
 * Express 5 / `@nestjs/serve-static` v5:
 *
 * 1. `serveRoot` is intentionally NOT set. The Express loader builds the
 *    fallback route path as `serveRoot + validatePath(renderPath)`. With
 *    `serveRoot: '/'` and the default `renderPath: '{*any}'` that collapses to
 *    `'/' + '/{*any}'` = `'//{*any}'`, a path-to-regexp pattern that only
 *    matches double-slash URLs, so normal single-slash client routes
 *    (`/apod/archive`) never hit the fallback and fell through to Nest's JSON
 *    404 — the original prod bug. Omitting `serveRoot` makes the loader use the
 *    else branch (`app.use(express.static(...))` mounted at `/` +
 *    `app.get(renderPath, renderFn)`), registering the catch-all at the
 *    un-prefixed `renderPath` (`{*any}`), which matches every path.
 *
 * 2. `exclude` uses `/api/{*any}` (path-to-regexp v8 wildcard syntax), NOT the
 *    legacy `/api/(.*)`. Express 5 ships path-to-regexp v8, which rejects the
 *    parenthesized-capture form with `PathError: Unexpected (`; that error was
 *    previously masked because the broken `//{*any}` renderPath meant the
 *    fallback handler (which evaluates `exclude`) was never reached. Once the
 *    renderPath is fixed, the exclude pattern must be v8-valid too, or every
 *    request surfaces a 500. `/api/{*any}` preserves the original semantics:
 *    any `/api/*` route is excluded from the SPA fallback so Nest controllers
 *    keep handling it, and unknown `/api/*` routes still return Nest's JSON
 *    404 (`{"statusCode":404,...}`), NOT the HTML shell.
 *
 * `/api/*` is excluded so Nest controllers keep handling API routes; unknown
 * `/api/*` routes fall through to Nest's router and return the standard JSON
 * 404 (`{"statusCode":404,...}`), NOT the HTML shell. Real static assets are
 * served by `express.static` with their correct (non-HTML) content-type.
 */
export function buildServeStaticOptions(
  rootPath: string,
): ServeStaticModuleOptions[] {
  return [
    {
      rootPath,
      exclude: ['/api/{*any}'],
      // `serveRoot` deliberately omitted — see docstring above.
    },
  ];
}
