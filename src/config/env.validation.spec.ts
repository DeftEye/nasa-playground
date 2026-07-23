import { validateEnv } from './env.validation';

/**
 * TDD specs for startup environment validation (VAL-ENV-001 / VAL-ENV-002 /
 * VAL-ENV-003).
 *
 * The `validateEnv` function is the `validate` hook wired into
 * `ConfigModule.forRoot`. It runs synchronously during `NestFactory.create`
 * (before the HTTP port is bound) and throws on missing/invalid required
 * configuration, so the process fails fast with a clear message naming the
 * offending variable.
 */
describe('env.validation / validateEnv', () => {
  // Baseline valid env used as the starting point for each scenario. Tests
  // mutate a clone and then restore nothing (no shared mutable state).
  const baseValid = {
    NODE_ENV: 'production',
    JWT_SECRET: 'prod-secret-for-tests',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'pass123',
    POSTGRES_DB: 'nasa_sky_tracker',
    NASA_API_KEY: 'DEMO_KEY',
    PORT: '3000',
  };

  const clone = (
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string> => {
    const out: Record<string, string> = { ...baseValid };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) {
        delete out[k];
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  it('returns the validated config when all required vars are present and valid (VAL-ENV-002)', () => {
    const result = validateEnv(clone());
    expect(result['JWT_SECRET']).toBe('prod-secret-for-tests');
    expect(result['POSTGRES_PORT']).toBe('5432');
  });

  it('throws naming JWT_SECRET when production is set and JWT_SECRET is missing (VAL-ENV-001)', () => {
    const env = clone({ JWT_SECRET: undefined });
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET/i);
  });

  it('throws naming JWT_SECRET when production is set and JWT_SECRET is empty (VAL-ENV-001)', () => {
    const env = clone({ JWT_SECRET: '' });
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET/i);
  });

  it('does NOT require JWT_SECRET outside production (dev fallback path)', () => {
    const env = clone({ NODE_ENV: 'development', JWT_SECRET: undefined });
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('throws naming POSTGRES_PORT when it is non-numeric (VAL-ENV-003)', () => {
    const env = clone({ POSTGRES_PORT: 'abc' });
    expect(() => validateEnv(env)).toThrow(/POSTGRES_PORT/i);
  });

  it('throws naming PORT when it is non-numeric (VAL-ENV-003)', () => {
    const env = clone({ PORT: 'not-a-port' });
    expect(() => validateEnv(env)).toThrow(/PORT/i);
  });

  it('throws when NODE_ENV is not a recognized value', () => {
    const env = clone({ NODE_ENV: 'staging' });
    expect(() => validateEnv(env)).toThrow(/NODE_ENV/i);
  });

  it('throws naming POSTGRES_DB when missing in production', () => {
    const env = clone({ POSTGRES_DB: undefined });
    expect(() => validateEnv(env)).toThrow(/POSTGRES_DB/i);
  });

  it('throws naming POSTGRES_HOST when missing in production', () => {
    const env = clone({ POSTGRES_HOST: undefined });
    expect(() => validateEnv(env)).toThrow(/POSTGRES_HOST/i);
  });

  it('rejects a non-numeric EONET_POLL_MINUTES when present', () => {
    const env = clone({ EONET_POLL_MINUTES: 'soon' });
    expect(() => validateEnv(env)).toThrow(/EONET_POLL_MINUTES/i);
  });

  it('rejects a non-boolean DISABLE_NOTIFICATION_MOCK when present', () => {
    const env = clone({ DISABLE_NOTIFICATION_MOCK: 'maybe' });
    expect(() => validateEnv(env)).toThrow(/DISABLE_NOTIFICATION_MOCK/i);
  });

  it('rejects a non-boolean AUTH_REQUIRED when present', () => {
    const env = clone({ AUTH_REQUIRED: 'yes' });
    expect(() => validateEnv(env)).toThrow(/AUTH_REQUIRED/i);
  });

  it('accepts the full documented optional set when values are well-formed', () => {
    const env = clone({
      NODE_ENV: 'production',
      JWT_EXPIRES_IN: '7d',
      EONET_POLL_MINUTES: '15',
      EONET_CLOSED_WINDOW_DAYS: '30',
      EONET_BOOT_CATCHUP: 'true',
      APOD_BOOT_CATCHUP: 'true',
      APOD_CRON: '0 16 * * *',
      APOD_TIMEOUT_MS: '15000',
      EONET_TIMEOUT_MS: '30000',
      APOD_BASE_URL: 'https://api.nasa.gov/planetary/apod',
      EONET_BASE_URL: 'https://eonet.gsfc.nasa.gov/api/v3',
      DISABLE_NOTIFICATION_MOCK: 'false',
      AUTH_REQUIRED: 'true',
    });
    expect(() => validateEnv(env)).not.toThrow();
  });
});
