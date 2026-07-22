import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as publicly accessible — the global
 * `JwtAuthGuard` skips authentication for routes carrying this decorator.
 *
 * Per architecture §4 / §7: auth `register`/`login`, NASA read endpoints
 * (`GET /api/nasa/apod/*`, `GET /api/nasa/eonet/*`), and `GET /api/nasa/health`
 * are public; everything else under `/api/*` requires a valid JWT.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
