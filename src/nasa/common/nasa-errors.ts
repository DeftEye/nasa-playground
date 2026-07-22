/**
 * Typed errors raised by {@link NasaClientService} so callers (schedulers,
 * services) can reason about retry semantics without sniffing message strings.
 */

/** Raised when the NASA API is unreachable, returns 5xx, times out, or emits malformed JSON. */
export class NasaApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NasaApiUnavailableError';
    Object.setPrototypeOf(this, NasaApiUnavailableError.prototype);
  }
}

/** Raised when NASA responds with HTTP 429 (rate limited). */
export class NasaApiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NasaApiRateLimitError';
    Object.setPrototypeOf(this, NasaApiRateLimitError.prototype);
  }
}
