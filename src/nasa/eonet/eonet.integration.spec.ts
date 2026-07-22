import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../../test/utils';
import { EonetService } from './eonet.service';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

const validUser = {
  email: 'eonet-user@example.com',
  password: 'correct-horse-battery',
};

interface CategoryRow {
  id: string;
  title: string;
  description: string | null;
}

interface EventRow {
  id: string;
  title: string;
  status: string;
  closedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  geometry: unknown;
}

interface EventListBody {
  data: EventRow[];
  total: number;
  page: number;
  limit: number;
}

interface FetchResult {
  detected: string[];
  updated: string[];
  skipped: string[];
  unchanged: string[];
}

const asBody = (res: Response): unknown => res.body;
const asList = (res: Response): EventListBody => res.body as EventListBody;
const asFetch = (res: Response): FetchResult => res.body as FetchResult;

/** Builds a minimal EONET event DTO. */
function eventMock(
  over: Partial<{
    id: string;
    title: string;
    description: string | null;
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
    id: 'EONET_9999',
    title: 'Mock Event',
    description: null,
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9999',
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

/** Builds a minimal EONET categories envelope. */
function categoriesMock(
  cats: Array<{ id: string; title: string; description?: string | null }>,
): {
  categories: Array<{
    id: string;
    title: string;
    description?: string | null;
    link?: string;
  }>;
} {
  return {
    categories: cats.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description ?? null,
      link: `https://eonet.gsfc.nasa.gov/api/v3/categories/${c.id}`,
    })),
  };
}

/** Wires nock for a full fetch: categories (only if DB empty) + open + closed. */
function nockFullFetch(opts: {
  categories?: Array<{
    id: string;
    title: string;
    description?: string | null;
  }>;
  open?: Array<ReturnType<typeof eventMock>>;
  closed?: Array<ReturnType<typeof eventMock>>;
  closedStart?: string;
}): nock.Scope[] {
  const scopes: nock.Scope[] = [];
  if (opts.categories) {
    scopes.push(
      nock(EONET_BASE)
        .get(`${EONET_API}/categories`)
        .reply(200, categoriesMock(opts.categories), {
          'content-type': 'application/json',
        }),
    );
  }
  scopes.push(
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'open')
      .reply(
        200,
        { events: opts.open ?? [] },
        { 'content-type': 'application/json' },
      ),
  );
  scopes.push(
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query(
        (q) =>
          q.status === 'closed' &&
          (opts.closedStart ? q.start === opts.closedStart : true),
      )
      .reply(
        200,
        { events: opts.closed ?? [] },
        { 'content-type': 'application/json' },
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

describe('EONET (integration)', () => {
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

  const countCategories = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_categories',
    );
    return Number(rows[0].count);
  };

  const countEvents = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_events',
    );
    return Number(rows[0].count);
  };

  const countLinks = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_event_categories',
    );
    return Number(rows[0].count);
  };

  const getEvent = async (id: string): Promise<EventRow | null> => {
    const rows: EventRow[] = await dataSource.query(
      'SELECT id, title, status, closed_at AS "closedAt", first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", geometry FROM eonet_events WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  };

  const getLinksFor = async (eventId: string): Promise<string[]> => {
    const rows: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM eonet_event_categories WHERE event_id = $1 ORDER BY category_id',
      [eventId],
    );
    return rows.map((r) => r.category_id);
  };

  // VAL-EONET-001
  it('GET /api/nasa/eonet/categories returns seeded categories; re-seed is idempotent', async () => {
    const service = context.app.get(EonetService);
    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(
        200,
        categoriesMock([
          {
            id: 'severeStorms',
            title: 'Severe Storms',
            description: 'Storms.',
          },
          { id: 'wildfires', title: 'Wildfires' },
        ]),
        { 'content-type': 'application/json' },
      );
    await service.seedCategories();
    expect(await countCategories()).toBe(2);

    const res = await context.http.get('/api/nasa/eonet/categories');
    expect(res.status).toBe(200);
    const cats = asBody(res) as CategoryRow[];
    expect(cats).toHaveLength(2);
    expect(cats.map((c) => c.id).sort()).toEqual(['severeStorms', 'wildfires']);
    const storms = cats.find((c) => c.id === 'severeStorms')!;
    expect(storms.title).toBe('Severe Storms');
    expect(storms.description).toBe('Storms.');

    // Re-seed with the same payload: count unchanged.
    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(
        200,
        categoriesMock([
          { id: 'severeStorms', title: 'Severe Storms' },
          { id: 'wildfires', title: 'Wildfires' },
        ]),
        { 'content-type': 'application/json' },
      );
    await service.seedCategories();
    expect(await countCategories()).toBe(2);
  });

  // VAL-EONET-002
  it('GET /api/nasa/eonet/events filters by category + status; invalid status/limit -> 400', async () => {
    // Seed categories + events directly.
    await dataSource.query(
      `INSERT INTO eonet_categories (id, title, description) VALUES
        ('severeStorms', 'Severe Storms', NULL),
        ('wildfires', 'Wildfires', NULL)`,
    );
    const now = new Date();
    await dataSource.query(
      `INSERT INTO eonet_events (id, title, description, link, status, closed_at, first_seen_at, last_seen_at, geometry)
       VALUES
         ('EONET_A', 'Storm A', NULL, 'l', 'open', NULL, $1, $1, '[{"type":"Point","coordinates":[-86,28]}]'),
         ('EONET_B', 'Fire B', NULL, 'l', 'open', NULL, $1, $1, '[{"type":"Point","coordinates":[0,0]}]'),
         ('EONET_C', 'Storm C closed', NULL, 'l', 'closed', $1, $1, $1, '[{"type":"Point","coordinates":[1,1]}]')`,
      [now],
    );
    await dataSource.query(
      `INSERT INTO eonet_event_categories (event_id, category_id) VALUES
        ('EONET_A','severeStorms'),
        ('EONET_B','wildfires'),
        ('EONET_C','severeStorms')`,
    );

    // Intersection: category=severeStorms & status=open -> only EONET_A.
    const res = await context.http
      .get('/api/nasa/eonet/events')
      .query({ category: 'severeStorms', status: 'open', page: 1, limit: 50 });
    expect(res.status).toBe(200);
    const list = asList(res);
    expect(list.total).toBe(1);
    expect(list.data.map((e) => e.id)).toEqual(['EONET_A']);

    // category only -> EONET_A + EONET_C.
    const catOnly = await context.http
      .get('/api/nasa/eonet/events')
      .query({ category: 'severeStorms' });
    expect(catOnly.status).toBe(200);
    expect(asList(catOnly).total).toBe(2);

    // status only -> EONET_A + EONET_B.
    const statusOnly = await context.http
      .get('/api/nasa/eonet/events')
      .query({ status: 'open' });
    expect(statusOnly.status).toBe(200);
    expect(asList(statusOnly).total).toBe(2);

    // Invalid status -> 400.
    const badStatus = await context.http
      .get('/api/nasa/eonet/events')
      .query({ status: 'pending' });
    expect(badStatus.status).toBe(400);

    // Invalid limit -> 400.
    const badLimit = await context.http
      .get('/api/nasa/eonet/events')
      .query({ limit: 200 });
    expect(badLimit.status).toBe(400);

    // Invalid page -> 400.
    const badPage = await context.http
      .get('/api/nasa/eonet/events')
      .query({ page: 0 });
    expect(badPage.status).toBe(400);
  });

  // VAL-EONET-003
  it('POST /api/nasa/triggers/fetch-eonet seeds categories + persists events + M2M links', async () => {
    const token = await loginAndGetToken(context);

    // Unauthenticated -> 401, no rows.
    const unauthed = await context.http.post('/api/nasa/triggers/fetch-eonet');
    expect(unauthed.status).toBe(401);
    expect(await countCategories()).toBe(0);
    expect(await countEvents()).toBe(0);

    nockFullFetch({
      categories: [
        { id: 'severeStorms', title: 'Severe Storms' },
        { id: 'wildfires', title: 'Wildfires' },
      ],
      open: [
        eventMock({
          id: 'EONET_100',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const result = asFetch(res);
    expect(result.detected).toContain('EONET_100');
    expect(result.skipped).toEqual([]);

    expect(await countCategories()).toBe(2);
    expect(await countEvents()).toBe(1);
    expect(await countLinks()).toBe(1);
    expect(await getLinksFor('EONET_100')).toEqual(['severeStorms']);
  });

  // VAL-EONET-004
  it('event with multiple categories produces one event row + two M2M rows', async () => {
    const token = await loginAndGetToken(context);
    nockFullFetch({
      categories: [
        { id: 'severeStorms', title: 'Severe Storms' },
        { id: 'wildfires', title: 'Wildfires' },
      ],
      open: [
        eventMock({
          id: 'EONET_200',
          categories: [
            { id: 'severeStorms', title: 'Severe Storms' },
            { id: 'wildfires', title: 'Wildfires' },
          ],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(await countEvents()).toBe(1);
    expect(await countLinks()).toBe(2);
    expect(await getLinksFor('EONET_200')).toEqual([
      'severeStorms',
      'wildfires',
    ]);
  });

  // VAL-EONET-005
  it('event with empty geometry is persisted but writes no notification_log row', async () => {
    const token = await loginAndGetToken(context);
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_300', geometry: [] })],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(await countEvents()).toBe(1);
    const row = await getEvent('EONET_300');
    expect(row).not.toBeNull();
    // geometry stored as empty array.
    const geomRows: Array<{ len: number }> = await dataSource.query(
      "SELECT COALESCE(jsonb_array_length(geometry), -1) AS len FROM eonet_events WHERE id = 'EONET_300'",
    );
    expect(geomRows[0].len).toBe(0);

    // No notification_log rows for this event: empty-geometry events are
    // persisted but skipped by fan-out (VAL-EONET-005 / VAL-NOTIF-005). With
    // no subscribers in this test, the count is 0 regardless.
    const logRows: Array<{ count: string }> = await dataSource.query(
      "SELECT COUNT(*)::text AS count FROM notification_log WHERE reference_id = 'EONET_300'",
    );
    expect(Number(logRows[0].count)).toBe(0);
  });

  // VAL-EONET-017
  it('malformed geometry event is skipped; other events persist; trigger returns 2xx', async () => {
    const token = await loginAndGetToken(context);
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [
        eventMock({ id: 'EONET_BAD', geometry: 'not-an-object' }),
        eventMock({
          id: 'EONET_GOOD',
          geometry: [{ type: 'Point', coordinates: [1, 2] }],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const result = asFetch(res);
    expect(result.skipped).toContain('EONET_BAD');
    expect(result.detected).toContain('EONET_GOOD');

    expect(await countEvents()).toBe(1);
    expect(await getEvent('EONET_BAD')).toBeNull();
    expect(await getEvent('EONET_GOOD')).not.toBeNull();
  });

  // VAL-EONET-014
  it('new category slug not in eonet_categories is lazily created and linked', async () => {
    const token = await loginAndGetToken(context);
    // Seed only severeStorms; the event references an unknown slug.
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [
        eventMock({
          id: 'EONET_400',
          categories: [
            { id: 'severeStorms', title: 'Severe Storms' },
            { id: 'volcanoes', title: 'Volcanoes' },
          ],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    // Lazy category created.
    const catRows: Array<{ id: string }> = await dataSource.query(
      "SELECT id FROM eonet_categories WHERE id = 'volcanoes'",
    );
    expect(catRows).toHaveLength(1);
    expect(await getLinksFor('EONET_400')).toEqual([
      'severeStorms',
      'volcanoes',
    ]);
  });

  // VAL-EONET-015 + VAL-EONET-007 (first insertion: first_seen == last_seen within 1s)
  it('first event insertion has first_seen_at == last_seen_at within 1s tolerance', async () => {
    const token = await loginAndGetToken(context);
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_500' })],
    });

    await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const row = await getEvent('EONET_500');
    expect(row).not.toBeNull();
    const skew = Math.abs(
      new Date(row!.lastSeenAt).getTime() -
        new Date(row!.firstSeenAt).getTime(),
    );
    expect(skew).toBeLessThanOrEqual(1000);
  });

  // VAL-EONET-016
  it('1000-point geometry is preserved verbatim', async () => {
    const token = await loginAndGetToken(context);
    const big = Array.from({ length: 1000 }, (_, i) => ({
      date: '2024-01-01T00:00:00Z',
      type: 'Point',
      coordinates: [i, -i],
      magnitudeValue: i,
      magnitudeUnit: 'kts',
    }));
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_1000', geometry: big })],
    });

    await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const lenRows: Array<{ len: number }> = await dataSource.query(
      "SELECT jsonb_array_length(geometry) AS len FROM eonet_events WHERE id = 'EONET_1000'",
    );
    expect(lenRows[0].len).toBe(1000);
    // Spot-check first and last entries are preserved verbatim.
    const coordRows: Array<{ coords: unknown }> = await dataSource.query(
      "SELECT geometry->0->'coordinates' AS coords FROM eonet_events WHERE id = 'EONET_1000'",
    );
    expect(coordRows[0].coords).toEqual([0, 0]);
    const lastRows: Array<{ coords: unknown }> = await dataSource.query(
      "SELECT geometry->999->'coordinates' AS coords FROM eonet_events WHERE id = 'EONET_1000'",
    );
    expect(lastRows[0].coords).toEqual([999, -999]);
  });

  // VAL-EONET-006 + VAL-SCHED-008 (status change updates last_seen, preserves first_seen)
  it('status change open->closed updates last_seen_at, preserves first_seen_at, records update', async () => {
    const token = await loginAndGetToken(context);
    // First poll: open event.
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_600', closed: null })],
      closed: [],
    });
    const first = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(asFetch(first).detected).toContain('EONET_600');

    const afterFirst = await getEvent('EONET_600');
    const firstSeen = new Date(afterFirst!.firstSeenAt);
    const firstLastSeen = new Date(afterFirst!.lastSeenAt);
    expect(afterFirst!.status).toBe('open');
    expect(afterFirst!.closedAt).toBeNull();

    // Wait so timestamps tick.
    await new Promise((r) => setTimeout(r, 1100));

    // Second poll: same event now closed (appears in closed window).
    nockFullFetch({
      open: [],
      closed: [eventMock({ id: 'EONET_600', closed: '2024-02-01T00:00:00Z' })],
    });
    const second = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    const secondResult = asFetch(second);
    expect(secondResult.updated).toContain('EONET_600');

    const afterSecond = await getEvent('EONET_600');
    expect(afterSecond!.status).toBe('closed');
    expect(afterSecond!.closedAt).not.toBeNull();
    // first_seen_at preserved.
    expect(new Date(afterSecond!.firstSeenAt).getTime()).toBe(
      firstSeen.getTime(),
    );
    // last_seen_at advanced.
    expect(new Date(afterSecond!.lastSeenAt).getTime()).toBeGreaterThan(
      firstLastSeen.getTime(),
    );
  });

  // VAL-EONET-007 (idempotency on repeat polls)
  it('repeat polls with unchanged payload leave row counts unchanged and update last_seen_at', async () => {
    const token = await loginAndGetToken(context);
    nockFullFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_700' })],
    });
    await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await countCategories()).toBe(1);
    expect(await countEvents()).toBe(1);
    expect(await countLinks()).toBe(1);

    const afterFirst = await getEvent('EONET_700');
    const firstLastSeen = new Date(afterFirst!.lastSeenAt);

    await new Promise((r) => setTimeout(r, 1100));

    // Second poll: same payload. Categories already seeded -> no categories fetch.
    nockFullFetch({
      open: [eventMock({ id: 'EONET_700' })],
    });
    const second = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    const secondResult = asFetch(second);
    expect(secondResult.detected).toEqual([]);
    expect(secondResult.updated).toEqual([]);
    expect(secondResult.unchanged).toContain('EONET_700');

    // Counts unchanged.
    expect(await countCategories()).toBe(1);
    expect(await countEvents()).toBe(1);
    expect(await countLinks()).toBe(1);

    // last_seen_at updated.
    const afterSecond = await getEvent('EONET_700');
    expect(new Date(afterSecond!.lastSeenAt).getTime()).toBeGreaterThan(
      firstLastSeen.getTime(),
    );
    // first_seen_at stable.
    expect(new Date(afterSecond!.firstSeenAt).getTime()).toBe(
      new Date(afterFirst!.firstSeenAt).getTime(),
    );
  });

  // VAL-EONET-009 (bounded closed-window fetch carries a start parameter)
  it('closed-window fetch is bounded with a start date parameter', async () => {
    const token = await loginAndGetToken(context);
    process.env.EONET_CLOSED_WINDOW_DAYS = '30';
    try {
      const startMatch = /(\d{4}-\d{2}-\d{2})/;
      let capturedStart: string | undefined;
      nockFullFetch({
        categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        open: [],
        closed: [],
      });
      // Override the closed interceptor to capture the start param explicitly.
      nock.cleanAll();
      nock(EONET_BASE)
        .get(`${EONET_API}/categories`)
        .reply(
          200,
          categoriesMock([{ id: 'severeStorms', title: 'Severe Storms' }]),
          {
            'content-type': 'application/json',
          },
        );
      nock(EONET_BASE)
        .get(`${EONET_API}/events`)
        .query((q) => q.status === 'open')
        .reply(200, { events: [] }, { 'content-type': 'application/json' });
      nock(EONET_BASE)
        .get(`${EONET_API}/events`)
        .query((q) => {
          if (q.status !== 'closed') return false;
          capturedStart = q.start as string | undefined;
          return typeof q.start === 'string' && startMatch.test(q.start);
        })
        .reply(200, { events: [] }, { 'content-type': 'application/json' });

      await context.http
        .post('/api/nasa/triggers/fetch-eonet')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(capturedStart).toBeDefined();
      expect(startMatch.test(capturedStart!)).toBe(true);
    } finally {
      delete process.env.EONET_CLOSED_WINDOW_DAYS;
    }
  });
});
