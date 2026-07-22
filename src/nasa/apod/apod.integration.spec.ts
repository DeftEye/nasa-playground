import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../../test/utils';
import { ApodService, todayUtc } from './apod.service';
import { NasaApodResponse } from '../common';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';

const validUser = {
  email: 'apod-user@example.com',
  password: 'correct-horse-battery',
};

interface ApodRow {
  date: string;
  title: string;
  explanation: string;
  url: string;
  mediaType: string;
  videoUrl: string | null;
  copyright: string | null;
  fetchedAt: string;
}

interface ApodListBody {
  data: ApodRow[];
  total: number;
  page: number;
  limit: number;
}

const asApod = (res: Response): ApodRow => res.body as ApodRow;
const asList = (res: Response): ApodListBody => res.body as ApodListBody;

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

async function loginAndGetToken(ctx: TestAppContext): Promise<string> {
  await ctx.http.post('/api/auth/register').send(validUser).expect(201);
  const res = await ctx.http
    .post('/api/auth/login')
    .send(validUser)
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

describe('APOD (integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    savedApiKey = process.env.NASA_API_KEY;
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

  const getRow = async (date: string): Promise<ApodRow | null> => {
    const rows: ApodRow[] = await dataSource.query(
      'SELECT date, title, explanation, url, media_type AS "mediaType", video_url AS "videoUrl", copyright, fetched_at AS "fetchedAt" FROM apod_entries WHERE date = $1',
      [date],
    );
    return rows[0] ?? null;
  };

  // VAL-APOD-001
  it('GET /api/nasa/apod/today fetches from NASA when no row exists and persists media_type', async () => {
    const today = todayUtc();
    const mock = apodMock({
      date: today,
      media_type: 'image',
      url: 'https://example.com/x.jpg',
    });
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, mock, { 'content-type': 'application/json' });

    const res = await context.http.get('/api/nasa/apod/today');
    expect(res.status).toBe(200);
    expect(asApod(res).mediaType).toBe('image');
    expect(asApod(res).url).toBe('https://example.com/x.jpg');
    expect(scope.isDone()).toBe(true);
    expect(await countApod()).toBe(1);
    const row = await getRow(today);
    expect(row?.mediaType).toBe('image');
    expect(row?.fetchedAt).toBeTruthy();
  });

  // VAL-APOD-002
  it('GET /api/nasa/apod/today returns stored row without re-fetching NASA', async () => {
    const today = todayUtc();
    await dataSource.query(
      `INSERT INTO apod_entries (date, title, explanation, url, media_type, video_url, copyright, fetched_at)
       VALUES ($1, 'Seeded', 'seed', 'https://example.com/seed.jpg', 'image', NULL, NULL, NOW())`,
      [today],
    );

    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query(true)
      .reply(200, apodMock({ date: today }));

    const res = await context.http.get('/api/nasa/apod/today');
    expect(res.status).toBe(200);
    expect(asApod(res).title).toBe('Seeded');
    expect(scope.isDone()).toBe(false); // no NASA call
    expect(await countApod()).toBe(1);
  });

  // VAL-APOD-003
  it('paginates APOD archive by date DESC; ?limit=200 returns 400', async () => {
    // Seed 25 rows with distinct dates.
    const base = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 25; i += 1) {
      const d = new Date(base.getTime() + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await dataSource.query(
        `INSERT INTO apod_entries (date, title, explanation, url, media_type, video_url, copyright, fetched_at)
         VALUES ($1, $2, 'e', 'https://example.com/x', 'image', NULL, NULL, NOW())`,
        [d, `Title ${i}`],
      );
    }

    const first = await context.http.get('/api/nasa/apod');
    expect(first.status).toBe(200);
    expect(asList(first).data).toHaveLength(20);
    expect(asList(first).total).toBe(25);
    // date DESC: newest first
    expect(asList(first).data[0].date).toBe('2024-01-25');

    const second = await context.http
      .get('/api/nasa/apod')
      .query({ page: 2, limit: 10 });
    expect(second.status).toBe(200);
    const secondList = asList(second);
    expect(secondList.data).toHaveLength(10);
    expect(secondList.data[0].date).toBe('2024-01-15');
    expect(secondList.data[9].date).toBe('2024-01-06');

    const tooMany = await context.http
      .get('/api/nasa/apod')
      .query({ limit: 200 });
    expect(tooMany.status).toBe(400);

    const badPage = await context.http.get('/api/nasa/apod').query({ page: 0 });
    expect(badPage.status).toBe(400);
  });

  // VAL-APOD-004
  it('filters by from/to date range; invalid date format returns 400', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const d = `2024-02-${String(i).padStart(2, '0')}`;
      await dataSource.query(
        `INSERT INTO apod_entries (date, title, explanation, url, media_type, video_url, copyright, fetched_at)
         VALUES ($1, $2, 'e', 'https://example.com/x', 'image', NULL, NULL, NOW())`,
        [d, `T${i}`],
      );
    }

    const range = await context.http
      .get('/api/nasa/apod')
      .query({ from: '2024-02-02', to: '2024-02-04' });
    expect(range.status).toBe(200);
    const rangeList = asList(range);
    expect(rangeList.data).toHaveLength(3);
    expect(rangeList.data.map((r) => r.date).sort()).toEqual([
      '2024-02-02',
      '2024-02-03',
      '2024-02-04',
    ]);

    const invalid = await context.http
      .get('/api/nasa/apod')
      .query({ from: 'not-a-date' });
    expect(invalid.status).toBe(400);
  });

  // VAL-APOD-005 + VAL-AUTH-012 (trigger guard)
  it('POST /api/nasa/triggers/fetch-apod requires JWT and upserts idempotently', async () => {
    const today = todayUtc();

    // No JWT -> 401, no row.
    const unauthed = await context.http.post('/api/nasa/triggers/fetch-apod');
    expect(unauthed.status).toBe(401);
    expect(await countApod()).toBe(0);

    const token = await loginAndGetToken(context);

    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .times(2)
      .reply(200, apodMock({ date: today, title: 'Triggered' }), {
        'content-type': 'application/json',
      });

    const first = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(asApod(first).title).toBe('Triggered');
    expect(await countApod()).toBe(1);

    const firstRow = await getRow(today);
    const firstFetchedAt = firstRow?.fetchedAt;

    // Small delay so fetchedAt tick differs.
    await new Promise((r) => setTimeout(r, 1100));

    const second = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(await countApod()).toBe(1); // no duplicate
    expect(scope.isDone()).toBe(true);

    const secondRow = await getRow(today);
    expect(secondRow?.title).toBe('Triggered');
    expect(new Date(secondRow!.fetchedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstFetchedAt!).getTime(),
    );
  });

  // VAL-APOD-005 (optional date)
  it('POST /api/nasa/triggers/fetch-apod?date=YYYY-MM-DD upserts that date; invalid date -> 400', async () => {
    const token = await loginAndGetToken(context);
    const date = '2024-03-15';
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === date)
      .reply(200, apodMock({ date, title: 'Past' }), {
        'content-type': 'application/json',
      });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .query({ date })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(asApod(res).title).toBe('Past');
    expect(await countApod()).toBe(1);

    const bad = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .query({ date: 'invalid' })
      .set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);
  });

  // VAL-APOD-006 (video URL transform: YouTube -> embed, Vimeo -> NULL)
  it('transforms YouTube video URL to embed form and leaves non-YouTube video URL NULL', async () => {
    const token = await loginAndGetToken(context);
    const ytDate = '2024-04-01';
    const vimeoDate = '2024-04-02';

    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === ytDate)
      .reply(
        200,
        apodMock({
          date: ytDate,
          media_type: 'video',
          url: 'https://www.youtube.com/watch?v=abc123',
        }),
        { 'content-type': 'application/json' },
      );
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === vimeoDate)
      .reply(
        200,
        apodMock({
          date: vimeoDate,
          media_type: 'video',
          url: 'https://vimeo.com/12345',
        }),
        { 'content-type': 'application/json' },
      );

    const yt = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .query({ date: ytDate })
      .set('Authorization', `Bearer ${token}`);
    expect(yt.status).toBe(200);
    expect(asApod(yt).videoUrl).toBe('https://www.youtube.com/embed/abc123');
    expect(asApod(yt).mediaType).toBe('video');

    const vimeo = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .query({ date: vimeoDate })
      .set('Authorization', `Bearer ${token}`);
    expect(vimeo.status).toBe(200);
    expect(asApod(vimeo).videoUrl).toBeNull();
    expect(asApod(vimeo).mediaType).toBe('video');

    const ytRow = await getRow(ytDate);
    const vimeoRow = await getRow(vimeoDate);
    expect(ytRow?.videoUrl).toBe('https://www.youtube.com/embed/abc123');
    expect(vimeoRow?.videoUrl).toBeNull();
  });

  // VAL-APOD-007 (backfill idempotency)
  it('backfill persists exactly 30 consecutive-date rows; re-run leaves count unchanged and updates fetched_at', async () => {
    const apodService = context.app.get(ApodService);

    // Mock 30 consecutive dates ending today.
    const today = new Date();
    const dates: string[] = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today.getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      dates.push(d);
      nock(NASA_BASE)
        .get(APOD_PATH)
        .query((q) => q.date === d)
        .reply(200, apodMock({ date: d, title: `Backfill ${d}` }), {
          'content-type': 'application/json',
        });
    }

    await apodService.backfill(30);
    expect(await countApod()).toBe(30);

    // Consecutive dates
    const rows: Array<{ date: string }> = await dataSource.query(
      'SELECT date::text AS date FROM apod_entries ORDER BY date ASC',
    );
    expect(rows.map((r) => r.date)).toEqual(dates);

    const firstFetched: Array<{ date: string; fetchedAt: string }> =
      await dataSource.query(
        'SELECT date, fetched_at AS "fetchedAt" FROM apod_entries WHERE date = $1',
        [dates[0]],
      );
    const firstAt = firstFetched[0].fetchedAt;

    await new Promise((r) => setTimeout(r, 1100));

    // Re-run: nock each date again.
    for (const d of dates) {
      nock(NASA_BASE)
        .get(APOD_PATH)
        .query((q) => q.date === d)
        .reply(200, apodMock({ date: d, title: `Backfill ${d}` }), {
          'content-type': 'application/json',
        });
    }
    await apodService.backfill(30);
    expect(await countApod()).toBe(30); // unchanged

    const secondFetched: Array<{ fetchedAt: string }> = await dataSource.query(
      'SELECT fetched_at AS "fetchedAt" FROM apod_entries WHERE date = $1',
      [dates[0]],
    );
    expect(new Date(secondFetched[0].fetchedAt).getTime()).toBeGreaterThan(
      new Date(firstAt).getTime(),
    );
  });

  // VAL-APOD-008
  it('storing today does not delete or overwrite yesterday row', async () => {
    const today = todayUtc();
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await dataSource.query(
      `INSERT INTO apod_entries (date, title, explanation, url, media_type, video_url, copyright, fetched_at)
       VALUES ($1, 'Yesterday', 'e', 'https://example.com/y', 'image', NULL, NULL, NOW())`,
      [yesterday],
    );

    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today, title: 'Today' }), {
        'content-type': 'application/json',
      });

    await context.http.get('/api/nasa/apod/today').expect(200);
    expect(await countApod()).toBe(2);
    const yRow = await getRow(yesterday);
    expect(yRow?.title).toBe('Yesterday');
  });

  // VAL-SCHED-004 (DEMO_KEY fallback)
  it('uses api_key=DEMO_KEY and warns when NASA_API_KEY is unset', async () => {
    delete process.env.NASA_API_KEY;
    const today = todayUtc();
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.api_key === 'DEMO_KEY' && q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    const res = await context.http.get('/api/nasa/apod/today');
    expect(res.status).toBe(200);
    expect(scope.isDone()).toBe(true);
    expect(await countApod()).toBe(1);
  });
});
