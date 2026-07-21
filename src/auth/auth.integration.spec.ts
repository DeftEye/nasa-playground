import jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';
import { buildCorsOptions } from '../config/cors.config';

const VITE_ORIGIN = 'http://localhost:5173';
const validUser = {
  email: 'alice@example.com',
  password: 'correct-horse-battery',
};

interface PublicUserBody {
  id: string;
  email: string;
  createdAt: string;
}

interface LoginBody {
  accessToken: string;
  user: PublicUserBody;
}

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

const asUser = (res: Response): PublicUserBody => res.body as PublicUserBody;
const asLogin = (res: Response): LoginBody => res.body as LoginBody;
const asError = (res: Response): ErrorBody => res.body as ErrorBody;

const expectPublicUser = (
  user: PublicUserBody,
  expected: { id?: string; email: string },
): void => {
  expect(typeof user.id).toBe('string');
  if (expected.id) {
    expect(user.id).toBe(expected.id);
  }
  expect(user.email).toBe(expected.email);
  expect(typeof user.createdAt).toBe('string');
  expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'id']);
};

describe('Auth (integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDb(dataSource);
  });

  const register = (body: Record<string, unknown> = validUser) =>
    context.http.post('/api/auth/register').send(body);

  const login = (body: Record<string, unknown> = validUser) =>
    context.http.post('/api/auth/login').send(body);

  const countUsers = async (email?: string): Promise<number> => {
    const rows: Array<{ count: string }> = email
      ? await dataSource.query(
          'SELECT COUNT(*)::text AS count FROM users WHERE email = $1',
          [email],
        )
      : await dataSource.query('SELECT COUNT(*)::text AS count FROM users');
    return Number(rows[0].count);
  };

  // VAL-AUTH-001
  it('registers a user, returns {id,email,createdAt} without passwordHash, hashes with bcrypt, rejects duplicate with 409', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expectPublicUser(asUser(res), { email: validUser.email });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password');

    const rows: Array<{ password_hash: string }> = await dataSource.query(
      'SELECT password_hash FROM users WHERE email = $1',
      [validUser.email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$10\$/);

    const dup = await register();
    expect(dup.status).toBe(409);
    expect(await countUsers(validUser.email)).toBe(1);
  });

  // VAL-AUTH-002
  it('rejects malformed email with 400 referencing email and inserts no row', async () => {
    const res = await register({
      email: 'not-an-email',
      password: 'longenough',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(asError(res).message)).toMatch(/email/i);
    expect(await countUsers()).toBe(0);
  });

  // VAL-AUTH-003
  it('rejects password shorter than 8 chars with 400 referencing password and inserts no row', async () => {
    const res = await register({ email: 'bob@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(asError(res).message)).toMatch(/password/i);
    expect(await countUsers()).toBe(0);
  });

  // VAL-AUTH-004
  it('rejects missing fields with 400 and inserts no row', async () => {
    const noEmail = await register({ password: 'longenough' });
    expect(noEmail.status).toBe(400);
    expect(JSON.stringify(asError(noEmail).message)).toMatch(/email/i);

    const noPassword = await register({ email: 'carol@example.com' });
    expect(noPassword.status).toBe(400);
    expect(JSON.stringify(asError(noPassword).message)).toMatch(/password/i);

    expect(await countUsers()).toBe(0);
  });

  // VAL-AUTH-005
  it('logs in and returns {accessToken, user} with no passwordHash; JWT decodes to sub=userId', async () => {
    const reg = await register();
    const res = await login();
    expect(res.status).toBe(200);
    const body = asLogin(res);
    expect(body).toHaveProperty('accessToken');
    expectPublicUser(body.user, { id: asUser(reg).id, email: validUser.email });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);

    const token = body.accessToken;
    expect(token.split('.')).toHaveLength(3);
    const decoded = jwt.decode(token) as { sub: string; email: string };
    expect(decoded.sub).toBe(asUser(reg).id);
    expect(decoded.email).toBe(validUser.email);
  });

  // VAL-AUTH-006
  it('returns 401 with no accessToken for wrong password', async () => {
    await register();
    const res = await login({
      email: validUser.email,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accessToken');
  });

  // VAL-AUTH-007
  it('returns 401 for unknown email, indistinguishable from wrong password', async () => {
    await register();
    const unknown = await login({
      email: 'ghost@example.com',
      password: 'whatever12',
    });
    const wrong = await login({
      email: validUser.email,
      password: 'wrong-password',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  // VAL-AUTH-008
  it('GET /api/auth/me with valid JWT returns current user without passwordHash', async () => {
    const reg = await register();
    const loginRes = await login();
    const res = await context.http
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${asLogin(loginRes).accessToken}`);
    expect(res.status).toBe(200);
    expectPublicUser(asUser(res), {
      id: asUser(reg).id,
      email: validUser.email,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  // VAL-AUTH-009
  it('GET /api/auth/me without or with malformed Authorization returns 401', async () => {
    const none = await context.http.get('/api/auth/me');
    expect(none.status).toBe(401);
    const malformed = await context.http
      .get('/api/auth/me')
      .set('Authorization', 'NotBearer abc.def.ghi');
    expect(malformed.status).toBe(401);
  });

  // VAL-AUTH-010
  it('GET /api/auth/me with tampered or foreign-secret JWT returns 401', async () => {
    await register();
    const loginRes = await login();
    const token = asLogin(loginRes).accessToken;

    const segments = token.split('.');
    const tamperedPayload =
      segments[1][0] === 'A'
        ? 'B' + segments[1].slice(1)
        : 'A' + segments[1].slice(1);
    const tampered = `${segments[0]}.${tamperedPayload}.${segments[2]}`;
    const tamperedRes = await context.http
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(tamperedRes.status).toBe(401);

    const foreign = jwt.sign(
      { sub: 'someone', email: validUser.email },
      'a-totally-different-secret',
      { expiresIn: '7d' },
    );
    const foreignRes = await context.http
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${foreign}`);
    expect(foreignRes.status).toBe(401);
  });

  // VAL-AUTH-011
  it('register -> login -> /me round-trip agrees on id and email', async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    const loginRes = await login();
    expect(loginRes.status).toBe(200);
    const meRes = await context.http
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${asLogin(loginRes).accessToken}`);
    expect(meRes.status).toBe(200);

    const regUser = asUser(reg);
    const loginUser = asLogin(loginRes).user;
    const meUser = asUser(meRes);
    expect(loginUser.id).toBe(regUser.id);
    expect(meUser.id).toBe(regUser.id);
    expect(loginUser.email).toBe(regUser.email);
    expect(meUser.email).toBe(regUser.email);
  });

  // VAL-AUTH-012
  it('JWT write-guarded endpoints reject unauthenticated calls with 401 (DELETE /api/auth/me)', async () => {
    await register();
    const del = await context.http.delete('/api/auth/me');
    expect(del.status).toBe(401);
    expect(await countUsers(validUser.email)).toBe(1);
  });

  // VAL-AUTH-012 (companion): DELETE /api/auth/me with JWT returns 204 and cascades
  it('DELETE /api/auth/me with valid JWT returns 204 and removes the user (FK cascade)', async () => {
    await register();
    const loginRes = await login();
    const del = await context.http
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${asLogin(loginRes).accessToken}`);
    expect(del.status).toBe(204);
    expect(await countUsers(validUser.email)).toBe(0);
  });

  // VAL-AUTH-013
  it('login is not rate-limited: 10 rapid failed logins all return 401 (no 429)', async () => {
    await register();
    for (let i = 0; i < 10; i += 1) {
      const res = await login({
        email: validUser.email,
        password: 'wrong-password',
      });
      expect(res.status).toBe(401);
    }
  });

  // VAL-AUTH-014
  it('CORS allows the Vite origin in dev, denies foreign origins, and is disabled in prod', async () => {
    const allowed = await context.http
      .options('/api/auth/login')
      .set('Origin', VITE_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(VITE_ORIGIN);

    const denied = await context.http
      .options('/api/auth/login')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    expect(buildCorsOptions('production')).toBe(false);
    expect(buildCorsOptions('development')).not.toBe(false);
  });
});
