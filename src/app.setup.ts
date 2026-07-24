import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { buildCorsOptions } from './config/cors.config';
import { NasaErrorsFilter } from './nasa/common/nasa-errors.filter';

/**
 * Shared runtime wiring applied identically by the production bootstrap
 * (`main.ts`) and the integration test harness so both exercise the same
 * request pipeline: `/api` global prefix, whitelisting validation pipe,
 * helmet security headers, and the environment-aware CORS policy.
 *
 * Helmet is applied first so its security headers land on every response,
 * including error responses short-circuited by later middleware/pipes
 * (VAL-HARD-001). Existing CORS/ValidationPipe behavior is preserved.
 *
 * The Content-Security-Policy STARTS FROM helmet's defaults (useDefaults is
 * left on, so default-src 'self', script-src 'self', object-src 'none',
 * style-src, frame-ancestors, etc. all remain) and only WIDENS two
 * directives to unblock prod-only breakage (VAL-PRODFIX-001/002/003):
 *   - img-src adds https://apod.nasa.gov so external APOD images load.
 *   - frame-src adds YouTube + Vimeo player origins so video embeds load.
 * Helmet is NOT disabled and no other header is touched; the strict
 * allowlist is preserved (no blanket https: for img-src).
 */
export function configureApp(app: INestApplication): void {
  // Helmet default set: X-Content-Type-Options: nosniff, X-DNS-Prefetch-Control,
  // Strict-Transport-Security, X-Frame-Options, etc. (VAL-HARD-001). The CSP
  // customization below keeps useDefaults on, so every default directive and
  // every other helmet header remains in place.
  app.use(
    helmet({
      contentSecurityPolicy: {
        // useDefaults: true (helmet default) => start from helmet's full
        // default directive set and only widen the two directives below.
        directives: {
          'img-src': ["'self'", 'data:', 'https://apod.nasa.gov'],
          'frame-src': [
            'https://www.youtube.com',
            'https://www.youtube-nocookie.com',
            'https://player.vimeo.com',
          ],
        },
      },
    }),
  );
  app.setGlobalPrefix('api');
  // Global exception filter mapping the NASA client's typed errors (plain
  // `Error` subclasses, NOT HttpException) to meaningful HTTP status codes so
  // a NASA failure never surfaces as a raw generic 500
  // (VAL-PRODFIX2-003): NasaApiUnavailableError -> 503,
  // NasaApiRateLimitError -> 429. Registered here (rather than via APP_FILTER)
  // so BOTH main.ts and the integration test harness exercise the same
  // mapping. The filter is a typed catch — HttpException and unknown errors
  // keep their existing behavior.
  app.useGlobalFilters(new NasaErrorsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const cors = buildCorsOptions();
  if (cors) {
    app.enableCors(cors);
  }
}
