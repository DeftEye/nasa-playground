import { Injectable, Logger } from '@nestjs/common';
import { request as httpRequest, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { NasaApiRateLimitError, NasaApiUnavailableError } from './nasa-errors';

/** APOD HTTP timeout floor (architecture §12). Exposed for tests/assertions. */
export const APOD_TIMEOUT_MS = 15_000;
/** EONET HTTP timeout floor (architecture §12). */
export const EONET_TIMEOUT_MS = 30_000;

const DEFAULT_APOD_BASE_URL = 'https://api.nasa.gov/planetary/apod';

/** Resolves the APOD base URL, honoring an `APOD_BASE_URL` override (tests). */
function apodBaseUrl(): string {
  return process.env.APOD_BASE_URL ?? DEFAULT_APOD_BASE_URL;
}

/** Resolves the APOD timeout, honoring an `APOD_TIMEOUT_MS` override (tests). */
function defaultApodTimeout(): number {
  const fromEnv = Number(process.env.APOD_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return APOD_TIMEOUT_MS;
}

/** Raw NASA APOD response shape (subset of fields we persist). */
export interface NasaApodResponse {
  date: string;
  title: string;
  explanation: string;
  url: string;
  media_type: string;
  copyright?: string;
}

/**
 * Resolves the NASA API key per call from the environment. When
 * `NASA_API_KEY` is unset or empty the public `DEMO_KEY` fallback is used and a
 * warning is emitted once so operators notice the rate-limited fallback.
 */
function resolveNasaApiKey(logger: Logger, warned: { value: boolean }): string {
  const fromEnv = process.env.NASA_API_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (!warned.value) {
    logger.warn(
      'NASA_API_KEY is not set; falling back to DEMO_KEY (rate-limited).',
    );
    warned.value = true;
  }
  return 'DEMO_KEY';
}

/**
 * Typed HTTP wrapper around Node's `https` module for NASA endpoints. No SDK
 * dependency. Enforces per-call timeouts and surfaces typed errors
 * ({@link NasaApiUnavailableError}, {@link NasaApiRateLimitError}) so retry
 * logic can be reasoned about uniformly.
 */
@Injectable()
export class NasaClientService {
  private readonly logger = new Logger(NasaClientService.name);
  private readonly demoKeyWarned = { value: false };

  /** Returns the API key used for outbound calls (DEMO_KEY fallback included). */
  apiKey(): string {
    return resolveNasaApiKey(this.logger, this.demoKeyWarned);
  }

  /**
   * Fetches a single APOD entry. `date` is optional (defaults to today per
   * NASA). Enforces the 15 s APOD timeout floor unless overridden (tests).
   * The default timeout can be narrowed via `APOD_TIMEOUT_MS` for tests so the
   * timeout path is exercisable without a 15 s wall clock.
   */
  getApod(
    date?: string,
    timeoutMs: number = defaultApodTimeout(),
  ): Promise<NasaApodResponse> {
    const url = new URL(apodBaseUrl());
    url.searchParams.set('api_key', this.apiKey());
    if (date) {
      url.searchParams.set('date', date);
    }
    return this.getJson<NasaApodResponse>(url, timeoutMs);
  }

  /**
   * Generic GET that streams the response body, parses JSON, and maps status
   * codes to typed errors. The socket inactivity timeout is enforced via
   * `req.setTimeout`; on timeout the request is destroyed and rejected with
   * {@link NasaApiUnavailableError}.
   */
  getJson<T>(url: URL, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const ok = (value: T): void => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const fail = (err: Error): void => {
        if (!settled) {
          settled = true;
          reject(
            err instanceof NasaApiUnavailableError ||
              err instanceof NasaApiRateLimitError
              ? err
              : new NasaApiUnavailableError(err.message),
          );
        }
      };

      const options: RequestOptions = {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
      };
      const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = transport(options, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 429) {
            fail(new NasaApiRateLimitError(`NASA API rate limited (429)`));
            return;
          }
          if (status >= 500) {
            fail(new NasaApiUnavailableError(`NASA API responded ${status}`));
            return;
          }
          if (status >= 400) {
            fail(new NasaApiUnavailableError(`NASA API responded ${status}`));
            return;
          }
          try {
            ok(JSON.parse(body) as T);
          } catch {
            fail(new NasaApiUnavailableError('NASA API returned invalid JSON'));
          }
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(
          new NasaApiUnavailableError(`NASA API timeout after ${timeoutMs}ms`),
        );
      });
      req.on('error', fail);
      req.end();
    });
  }
}
