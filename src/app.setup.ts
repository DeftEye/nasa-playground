import { INestApplication, ValidationPipe } from '@nestjs/common';
import { buildCorsOptions } from './config/cors.config';

/**
 * Shared runtime wiring applied identically by the production bootstrap
 * (`main.ts`) and the integration test harness so both exercise the same
 * request pipeline: `/api` global prefix, whitelisting validation pipe, and the
 * environment-aware CORS policy.
 */
export function configureApp(app: INestApplication): void {
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
