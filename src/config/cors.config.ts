import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEV_ALLOWED_ORIGIN = 'http://localhost:5173';

/**
 * In production the app is served same-origin via ServeStaticModule, so no CORS
 * headers are emitted (returns `false`). In every other environment only the
 * Vite dev origin is reflected; all other origins receive no `ACAO` header.
 */
export function buildCorsOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CorsOptions | false {
  if (nodeEnv === 'production') {
    return false;
  }

  return {
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, requestOrigin === DEV_ALLOWED_ORIGIN);
    },
    credentials: true,
  };
}
