import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { buildCorsOptions } from './config/cors.config';

/**
 * Shared runtime wiring applied identically by the production bootstrap
 * (`main.ts`) and the integration test harness so both exercise the same
 * request pipeline: `/api` global prefix, whitelisting validation pipe,
 * helmet security headers, and the environment-aware CORS policy.
 *
 * Helmet is applied first so its security headers land on every response,
 * including error responses short-circuited by later middleware/pipes
 * (VAL-HARD-001). Existing CORS/ValidationPipe behavior is preserved.
 */
export function configureApp(app: INestApplication): void {
  // Helmet default set: X-Content-Type-Options: nosniff, X-DNS-Prefetch-Control,
  // Strict-Transport-Security, X-Frame-Options, etc. (VAL-HARD-001).
  app.use(helmet());
  app.setGlobalPrefix('api');
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
