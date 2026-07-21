import { randomBytes } from 'node:crypto';

let cachedSecret: string | undefined;

/**
 * Resolves the JWT signing secret once per process. Uses `JWT_SECRET` from the
 * environment when present. Outside production a random secret is generated as a
 * dev-only fallback so the app boots without configuration; in production a
 * missing secret is fatal. Caching guarantees the JwtModule signer and the
 * passport strategy verifier share the exact same key within a process.
 */
export function resolveJwtSecret(): string {
  if (cachedSecret) {
    return cachedSecret;
  }

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  cachedSecret = randomBytes(32).toString('hex');
  return cachedSecret;
}
