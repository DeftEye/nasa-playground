import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';
import { dateNDaysAgo } from './apod/apod.service';
import { NasaApodResponse } from './common';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

const validUser = {
  email: 'backfill-user@example.com',
  password: 'correct-horse-battery',
};

interface ApodRow {
  date: string;
  title: string;
  fetchedAt: string;
}

interface EonetFetchResult {
  detected: string[];
  updated: string[];
  skipped: string[];
  unchanged: string[];
}

const asFetch = (res: Response): EonetFetchResult =>
  res.body as EonetFetchResult;

function apodMock(
  over: Partial<NasaApodResponse> & { date: string },
): NasaApodResponse {
  return {
    title: 'Mock APOD',
    explanation: 'An explanation.',
    url: 'https://example.com/image.jpg',
    media_type: 'image',
    ...over,
  };
}

function eonetEventMock(
  over: Partial<{
    id: string;
    title: string;
    link: string;
    closed: string | null;
    categories: Array<{ id: string; title: string }>;
    geometry: unknown;
  }>,
): {
  id: string;
  title: string;
  description: string | null;
  link: string;
  closed: string | null;
  categories: Array<{ id: string; title: string }>;
  geometry: unknown;
} {
  return {
    id: 'EONET_9001',
    title: 'Mock EONET Event',
    description: null,
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9001',
    closed: null,
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [
      {
        date: '2024-01-01T00:00:00Z',
        type: 'Point',
        coordinates: [-86, 28.5],
      },
    ],
    ...over,
  };
}

function nockEonetFullFetch(opts: {
  categories?: Array<{ id: string; title: string }>;
  open?: Array<ReturnType<typeof eonetEventMock>>;
  closed?: Array<ReturnType<typeof eonetEventMock>>;
}): nock.Scope[] {
  const scopes: nock.Scope[] = [];
  if (opts.categories) {
    scopes.push(
      nock(EONET_BASE)
        .get(`${EONET_API}/categories`)
        .reply(
          200,
          {
            categories: opts.categories.map((c) => ({
              id: c.id,
              title: c.title,
              description: null,
              link: `https://eonet.gsfc.nasa.gov/api/v3/categories/${c.id}`,
            })),
          },
          { 'content-type': 'application/json' },
        ),
    );
  }
  scopes.push(
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'open')
      .reply(
        200,
        { events: opts.open ?? [] },
        {
          'content-type': 'application/json',
        },
      ),
  );
  scopes.push(
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'closed')
      .reply(
        200,
        { events: opts.closed ?? [] },
        {
          'content-type': 'application/json',
        },
      ),
  );
  return scopes;
}

async function loginAndGetToken(ctx: TestAppContext): Promise<string> {
  await ctx.http.post('/api/auth/register').send(validUser).expect(201);
  const res = await ctx.http
    .post('/api/auth/login')
    .send(validUser)
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

describe('Backfill triggers (integration)', () => {
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

  const getApodRow = async (date: string): Promise<ApodRow | null> => {
    const rows: ApodRow[] = await dataSource.query(
      'SELECT date, title, fetched_at AS "fetchedAt" FROM apod_entries WHERE date = $1',
      [date],
    );
    return rows[0] ?? null;
  };

  /**
   * Mocks APOD for the last `days` consecutive dates ending today. Returns the
   * mocked date list (oldest -> newest) so assertions can verify row content.
   */
  const mockApodBackfill = (days: number, title = 'Backfill'): string[] => {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = dateNDaysAgo(i);
      dates.push(d);
      nock(NASA_BASE)
        .get(APOD_PATH)
        .query((q) => q.date === d)
        .reply(200, apodMock({ date: d, title: `${title} ${d}` }), {
          'content-type': 'application/json',
        });
    }
    return dates;
  };

  // VAL-PRODFIX-004 + VAL-PRODFIX-006 (happy path on a NON-empty table)
  it('POST /api/nasa/triggers/backfill-apod?days=30 (JWT) returns 200 and persists consecutive rows on a non-empty table', async () => {
    const token = await loginAndGetToken(context);

    // Pre-seed one unrelated row so the table is NON-empty (mirrors prod).
    const seedDate = dateNDaysAgo(400);
    await dataSource.query(
      `INSERT INTO apod_entries (date, title, explanation, url, media_type, video_url, copyright, fetched_at)
       VALUES ($1, 'Seed', 'e', 'https://example.com/seed.jpg', 'image', NULL, NULL, NOW())`,
      [seedDate],
    );
    expect(await countApod()).toBe(1);

    const dates = mockApodBackfill(30);

    const res = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .query({ days: 30 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Response is an array of persisted rows.
    const rows = res.body as ApodRow[];
    expect(rows).toHaveLength(30);
    // Row count increased to 31 (seed + 30 backfilled).
    expect(await countApod()).toBe(31);

    // The 30 consecutive dates are present.
    const storedDates: Array<{ date: string }> = await dataSource.query(
      `SELECT date::text AS date FROM apod_entries WHERE date <> $1 ORDER BY date ASC`,
      [seedDate],
    );
    expect(storedDates.map((r) => r.date)).toEqual(dates);
  });

  // VAL-PRODFIX-004 (default days = 30)
  it('POST /api/nasa/triggers/backfill-apod with no days defaults to 30', async () => {
    const token = await loginAndGetToken(context);
    mockApodBackfill(30);

    const res = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as ApodRow[]).length).toBe(30);
    expect(await countApod()).toBe(30);
  });

  // VAL-PRODFIX-004 (smaller window honored)
  it('POST /api/nasa/triggers/backfill-apod?days=5 persists 5 rows', async () => {
    const token = await loginAndGetToken(context);
    mockApodBackfill(5);

    const res = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .query({ days: 5 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as ApodRow[]).length).toBe(5);
    expect(await countApod()).toBe(5);
  });

  // VAL-PRODFIX-004 (idempotency)
  it('re-running backfill-apod does not duplicate rows; only refreshes fetched_at', async () => {
    const token = await loginAndGetToken(context);
    const dates = mockApodBackfill(30);

    const first = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .query({ days: 30 })
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(await countApod()).toBe(30);

    const firstRow = await getApodRow(dates[0]);
    const firstFetchedAt = firstRow?.fetchedAt;
    expect(firstFetchedAt).toBeTruthy();

    // 1.5s guarantees the second run's `new Date()` (ms precision in pg) is
    // strictly after the first, even under scheduler/IO jitter.
    await new Promise((r) => setTimeout(r, 1500));

    // Re-mock and re-run.
    mockApodBackfill(30);
    const second = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .query({ days: 30 })
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(await countApod()).toBe(30); // unchanged

    const secondRow = await getApodRow(dates[0]);
    expect(secondRow?.title).toBe(`Backfill ${dates[0]}`);
    expect(new Date(secondRow!.fetchedAt).getTime()).toBeGreaterThan(
      new Date(firstFetchedAt!).getTime(),
    );
  });

  // VAL-PRODFIX-004 (invalid days -> 400)
  it.each([
    ['days=0', 0],
    ['days=-1', -1],
    ['days=31', 31],
    ['days=abc', 'abc'],
    ['days=1.5', 1.5],
  ])(
    'POST /api/nasa/triggers/backfill-apod?%s returns 400',
    async (_label, days) => {
      const token = await loginAndGetToken(context);
      const res = await context.http
        .post('/api/nasa/triggers/backfill-apod')
        .query({ days })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(await countApod()).toBe(0);
    },
  );

  // VAL-PRODFIX-006 (APOD backfill requires JWT)
  it('POST /api/nasa/triggers/backfill-apod without a JWT returns 401', async () => {
    const res = await context.http
      .post('/api/nasa/triggers/backfill-apod')
      .query({ days: 30 });
    expect(res.status).toBe(401);
    expect(await countApod()).toBe(0);
  });

  // VAL-PRODFIX-005 + VAL-PRODFIX-006 (EONET happy path)
  it('POST /api/nasa/triggers/backfill-eonet (JWT) returns 200 with diff summary and persists events', async () => {
    const token = await loginAndGetToken(context);

    nockEonetFullFetch({
      categories: [
        { id: 'severeStorms', title: 'Severe Storms' },
        { id: 'wildfires', title: 'Wildfires' },
      ],
      open: [
        eonetEventMock({
          id: 'EONET_500',
          title: 'Storm Alpha',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
        eonetEventMock({
          id: 'EONET_501',
          title: 'Fire Beta',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/backfill-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const result = asFetch(res);
    expect(result.detected).toEqual(
      expect.arrayContaining(['EONET_500', 'EONET_501']),
    );
    expect(result.skipped).toEqual([]);
    expect(await countEonetEvents()).toBe(2);
  });

  // VAL-PRODFIX-005 (idempotency)
  it('re-running backfill-eonet does not duplicate events', async () => {
    const token = await loginAndGetToken(context);

    const runMocks = () =>
      nockEonetFullFetch({
        categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        open: [
          eonetEventMock({
            id: 'EONET_600',
            title: 'Persistent Storm',
            categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          }),
        ],
      });

    runMocks();
    const first = await context.http
      .post('/api/nasa/triggers/backfill-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(asFetch(first).detected).toContain('EONET_600');
    expect(await countEonetEvents()).toBe(1);

    runMocks();
    const second = await context.http
      .post('/api/nasa/triggers/backfill-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    const secondResult = asFetch(second);
    expect(secondResult.detected).toEqual([]);
    expect(secondResult.unchanged).toContain('EONET_600');
    expect(await countEonetEvents()).toBe(1); // unchanged
  });

  // VAL-PRODFIX-006 (EONET backfill requires JWT)
  it('POST /api/nasa/triggers/backfill-eonet without a JWT returns 401', async () => {
    const res = await context.http.post('/api/nasa/triggers/backfill-eonet');
    expect(res.status).toBe(401);
    expect(await countEonetEvents()).toBe(0);
  });
});
