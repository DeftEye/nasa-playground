import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { NasaApiRateLimitError, NasaApiUnavailableError } from './nasa-errors';

/**
 * Maps the NASA client's typed errors (which extend plain `Error`, NOT
 * `HttpException`) to meaningful HTTP responses so a NASA failure never
 * surfaces as a raw generic 500 (VAL-PRODFIX2-003):
 *
 *   - {@link NasaApiUnavailableError} -> 503 Service Unavailable
 *   - {@link NasaApiRateLimitError}   -> 429 Too Many Requests
 *
 * Each mapped response carries a clean JSON body matching Nest's standard
 * error shape: `{ statusCode, message, error }`.
 *
 * This filter is registered with `@Catch(NasaApiUnavailableError,
 * NasaApiRateLimitError)` (a typed catch, NOT a catch-all) so Nest only
 * dispatches these two error types here. `HttpException` and unknown errors
 * keep their existing default behavior (HttpExceptions render their own
 * status/body; unknown errors still fall through to Nest's default 500
 * handler) — the filter never swallows or rewrites them.
 *
 * Registered globally in `configureApp` (`src/app.setup.ts`) via
 * `app.useGlobalFilters(new NasaErrorsFilter())` so BOTH the production
 * bootstrap (`main.ts`) and the integration test harness exercise the same
 * mapping.
 */
@Catch(NasaApiUnavailableError, NasaApiRateLimitError)
export class NasaErrorsFilter
  implements ExceptionFilter<NasaApiUnavailableError | NasaApiRateLimitError>
{
  catch(
    exception: NasaApiUnavailableError | NasaApiRateLimitError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof NasaApiUnavailableError) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: exception.message,
        error: 'Service Unavailable',
      });
      return;
    }

    // NasaApiRateLimitError (the only other type this filter catches).
    res.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: exception.message,
      error: 'Too Many Requests',
    });
  }
}
