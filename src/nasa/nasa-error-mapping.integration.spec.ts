import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

const validUser = {
  email: 'nasa-err-user@example.com',
  password: 'correct-horse-battery',
};

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

const asError = (res: Response): ErrorBody => res.body as ErrorBody;

async function loginAndGetToken(ctx: TestAppContext): Promise<string> {
  await ctx.http.post('/api/auth/register').send(validUser).expect(201);
  const res = await ctx.http
    .post('/api/auth/login')
    .send(validUser)
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

/**
 * VAL-PRODFIX2-003: the NASA client's typed errors
 * (`NasaApiUnavailableError`, `NasaApiRateLimitError`) extend plain `Error`,
 * not `HttpException`. Without a global mapping filter they propagate out of
 * controllers and Nest returns a generic 500. The `NasaErrorsFilter`
 * registered in `configureApp` maps:
 *   - NasaApiUnavailableError (NASA 5xx / timeout / malformed JSON) -> 503
 *   - NasaApiRateLimitError   (NASA 429)                          -> 429
 * each with a clean JSON body `{ statusCode, message, error }`, and does NOT
 * touch `HttpException` (400/401) or unknown errors.
 *
 * The filter is wired in `src/app.setup.ts configureApp`, which is applied by
 * BOTH `main.ts` and `createTestApp`, so these integration tests exercise the
 * same request pipeline as production.
 */
describe('NASA error mapping -> 503/429 (VAL-PRODFIX2-003, integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    savedApiKey = process.env.NASA_API_KEY;
    process.env.NASA_API_KEY = 'test-key';
  });

  afterAll(async () => {
    process.env.NASA_API_KEY = savedApiKey;
    await closeTestApp(context);
  });

  beforeEach(async () => {
    nock.cleanAll();
    await resetDb(dataSource);
  });

  const countApod = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM apod_entries',
    );
    return Number(rows[0].count);
  };

  const countEonetEvents = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_events',
    );
    return Number(rows[0].count);
  };

  it('NASA 5xx on fetch-apod -> 503 with JSON body {statusCode, message, error} (no 500)', async () => {
    const token = await loginAndGetToken(context);
    nock(NASA_BASE).get(APOD_PATH).query(true).reply(503, 'upstream down');

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    const body = asError(res);
    expect(body.statusCode).toBe(503);
    expect(body.error).toBe('Service Unavailable');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    // No row persisted on a failed fetch.
    expect(await countApod()).toBe(0);
  });

  it('NASA 429 on fetch-apod -> 429 with JSON body {statusCode, message, error}', async () => {
    const token = await loginAndGetToken(context);
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query(true)
      .reply(429, 'rate limited', { 'content-type': 'application/json' });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(429);
    const body = asError(res);
    expect(body.statusCode).toBe(429);
    expect(body.error).toBe('Too Many Requests');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(await countApod()).toBe(0);
  });

  it('NASA malformed JSON on fetch-apod -> 503 (unavailable path)', async () => {
    const token = await loginAndGetToken(context);
    nock(NASA_BASE).get(APOD_PATH).query(true).reply(200, 'this is not json', {
      'content-type': 'application/json',
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    const body = asError(res);
    expect(body.statusCode).toBe(503);
    expect(body.error).toBe('Service Unavailable');
    expect(await countApod()).toBe(0);
  });

  it('NASA 5xx on fetch-eonet -> 503 with JSON body (EONET path)', async () => {
    const token = await loginAndGetToken(context);
    nock(EONET_BASE).get(`${EONET_API}/categories`).reply(500, 'down');

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    const body = asError(res);
    expect(body.statusCode).toBe(503);
    expect(body.error).toBe('Service Unavailable');
    expect(await countEonetEvents()).toBe(0);
  });

  it('NASA 429 on fetch-eonet -> 429 with JSON body (EONET path)', async () => {
    const token = await loginAndGetToken(context);
    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(429, 'rate limited', { 'content-type': 'application/json' });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(429);
    const body = asError(res);
    expect(body.statusCode).toBe(429);
    expect(body.error).toBe('Too Many Requests');
    expect(await countEonetEvents()).toBe(0);
  });

  // The filter must NOT swallow / rewrite existing HttpException behavior.
  it('a 400 BadRequestException (invalid date) is unaffected -> still 400 with Nest body', async () => {
    const token = await loginAndGetToken(context);
    // No nock needed: the controller throws BadRequestException before any
    // NASA call because `date` is not a valid YYYY-MM-DD.
    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .query({ date: 'not-a-date' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    const body = asError(res);
    expect(body.statusCode).toBe(400);
    // Nest's default BadRequestException body uses `error: 'Bad Request'`.
    expect(body.error).toBe('Bad Request');
  });

  it('a 401 unauthenticated request is unaffected -> still 401', async () => {
    // No nock: the JWT guard rejects before any NASA call.
    const res = await context.http.post('/api/nasa/triggers/fetch-apod');

    expect(res.status).toBe(401);
    const body = asError(res);
    expect(body.statusCode).toBe(401);
  });
});
