/**
 * Startup environment validation (VAL-ENV-001 / VAL-ENV-002 / VAL-ENV-003).
 *
 * This is wired into `ConfigModule.forRoot({ validate })` and runs
 * synchronously during `NestFactory.create(AppModule)` — BEFORE the HTTP port
 * is bound (`app.listen`). On missing/invalid required configuration it
 * throws an `Error` whose message names the offending variable, so the
 * process fails fast with a non-zero exit and never binds the port.
 *
 * The contract:
 * - `NODE_ENV` (when set) must be one of `development | production | test`.
 * - Numeric vars (`PORT`, `POSTGRES_PORT`, `EONET_POLL_MINUTES`,
 *   `EONET_CLOSED_WINDOW_DAYS`, `APOD_TIMEOUT_MS`, `EONET_TIMEOUT_MS`) must be
 *   numeric when present.
 * - Boolean-string vars (`DISABLE_NOTIFICATION_MOCK`, `AUTH_REQUIRED`,
 *   `APOD_BOOT_CATCHUP`, `EONET_BOOT_CATCHUP`) must be `true`/`false` when set.
 * - In production: `JWT_SECRET` must be present and non-empty; the
 *   `POSTGRES_*` connection vars must all be present. Outside production the
 *   dev/test fallbacks in `jwt-secret.ts` and `app.module.ts` apply, so these
 *   are not enforced (the app must keep booting without a `.env` in dev/test).
 *
 * No new runtime dependency is introduced — this is plain TS. The function is
 * pure (it does not read `process.env` directly) so it is unit-testable in
 * isolation.
 *
 * Reference: architecture §9 (env vars the app actually reads) and
 * `library/prod-deploy.md` for the canonical list. `APOD_BACKOFF_MS` /
 * `EONET_BACKOFF_MS` are intentionally NOT validated here — they are Nest
 * injection tokens with hardcoded defaults and are never read from
 * `process.env`.
 */
const ALLOWED_NODE_ENVS = new Set(['development', 'production', 'test']);

const BOOLEAN_VARS = [
  'DISABLE_NOTIFICATION_MOCK',
  'AUTH_REQUIRED',
  'APOD_BOOT_CATCHUP',
  'EONET_BOOT_CATCHUP',
] as const;

const NUMERIC_VARS = [
  'PORT',
  'POSTGRES_PORT',
  'EONET_POLL_MINUTES',
  'EONET_CLOSED_WINDOW_DAYS',
  'APOD_TIMEOUT_MS',
  'EONET_TIMEOUT_MS',
] as const;

const PROD_REQUIRED_VARS = [
  'JWT_SECRET',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
] as const;

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Safe string representation of an arbitrary env value for error messages. */
const describeValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return typeof value;
};

const fail = (varName: string, reason: string): never => {
  // Prepend the variable name so callers/logs can grep for the offending var
  // (VAL-ENV-001 / VAL-ENV-003 require the error to name the variable).
  throw new Error(`Invalid environment configuration: ${varName} ${reason}.`);
};

/**
 * Validates a raw environment-variable record. Returns the same record
 * (typed as a config bag) when valid; throws an `Error` naming the offending
 * variable when invalid.
 */
export function validateEnv(config: Record<string, any>): Record<string, any> {
  const nodeEnv =
    typeof config['NODE_ENV'] === 'string' ? config['NODE_ENV'] : undefined;

  if (nodeEnv !== undefined && !ALLOWED_NODE_ENVS.has(nodeEnv)) {
    fail(
      'NODE_ENV',
      `must be one of development|production|test (got "${nodeEnv}")`,
    );
  }

  const isProduction = nodeEnv === 'production';

  // Numeric vars.
  for (const name of NUMERIC_VARS) {
    const raw: unknown = config[name];
    if (raw === undefined || raw === '' || raw === null) {
      continue;
    }
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
      fail(name, `must be a positive integer (got ${describeValue(raw)})`);
    }
  }

  // Boolean-string vars.
  for (const name of BOOLEAN_VARS) {
    const raw: unknown = config[name];
    if (raw === undefined || raw === '' || raw === null) {
      continue;
    }
    if (raw !== 'true' && raw !== 'false') {
      fail(name, `must be "true" or "false" (got ${describeValue(raw)})`);
    }
  }

  // Production-only required vars.
  if (isProduction) {
    for (const name of PROD_REQUIRED_VARS) {
      const raw: unknown = config[name];
      if (!isNonEmpty(raw)) {
        fail(name, 'is required in production but was not set');
      }
    }
  }

  return config;
}
