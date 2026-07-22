import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';
import { todayUtc } from './apod/apod.service';
import { NasaApodResponse, EonetEventDto } from './common';

/**
 * Integration specs for the M3 fan-out wiring
 * (`m3-fanout-integration-and-real-discord`): ApodService/EonetService →
 * NotificationService.fanOut after a successful diff with the matching
 * subscriber set. Covers VAL-NOTIF-006 (multi-category per-subscriber
 * cardinality), VAL-SCHED-006 (one log row per intended subscriber),
 * VAL-CROSS-004 (real-mode Discord payload shape), VAL-SUB-011 (category
 * toggle immediately reroutes fan-out), and failure isolation through the
 * trigger path.
 */

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

const webhookHost = 'https://discord.com';
const webhookPath = '/api/webhooks/111/real-token-abc';
const webhookUrl = `${webhookHost}${webhookPath}`;

interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  createdAt: string;
}

interface FetchResult {
  detected: string[];
  updated: string[];
  skipped: string[];
  unchanged: string[];
}

const asSub = (res: Response): PublicSubscriber => res.body as PublicSubscriber;
const asFetch = (res: Response): FetchResult => res.body as FetchResult;

async function seedCategories(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `INSERT INTO eonet_categories (id, title, description) VALUES
      ('severeStorms', 'Severe Storms', NULL),
      ('wildfires', 'Wildfires', NULL),
      ('volcanoes', 'Volcanoes', NULL)
    ON CONFLICT (id) DO NOTHING`,
  );
}

interface UserContext {
  userId: string;
  accessToken: string;
  authHeader: string;
}

async function registerAndLogin(
  context: TestAppContext,
  email: string,
): Promise<UserContext> {
  const password = 'correct-horse-battery';
  const reg = await context.http
    .post('/api/auth/register')
    .send({ email, password });
  expect(reg.status).toBe(201);
  const login = await context.http
    .post('/api/auth/login')
    .send({ email, password });
  expect(login.status).toBe(200);
  const body = login.body as { accessToken: string; user: { id: string } };
  return {
    userId: body.user.id,
    accessToken: body.accessToken,
    authHeader: `Bearer ${body.accessToken}`,
  };
}

async function createSubscriber(
  context: TestAppContext,
  user: UserContext,
  overrides: Partial<{
    name: string;
    enabled: boolean;
    apodEnabled: boolean;
    eonetCategorySlugs: string[];
    discordWebhookUrl: string;
  }> = {},
): Promise<PublicSubscriber> {
  const res = await context.http
    .post('/api/subscribers')
    .set('Authorization', user.authHeader)
    .send({
      name: overrides.name ?? 'Sub',
      discordWebhookUrl: overrides.discordWebhookUrl ?? webhookUrl,
      apodEnabled: overrides.apodEnabled ?? true,
      enabled: overrides.enabled ?? true,
      eonetCategorySlugs: overrides.eonetCategorySlugs ?? [],
    });
  expect(res.status).toBe(201);
  return asSub(res);
}

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

/** Builds a minimal EONET event DTO. */
function eonetEvent(
  over: Partial<EonetEventDto> & { id: string },
): EonetEventDto {
  return {
    title: 'Mock Event',
    description: null,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/${over.id}`,
    closed: null,
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [{ type: 'Point', coordinates: [-86, 28.5] }],
    ...over,
  };
}

/** Nocks a full EONET fetch: categories (optional) + open + closed events. */
function nockEonetFetch(opts: {
  categories?: Array<{ id: string; title: string }>;
  open?: EonetEventDto[];
  closed?: EonetEventDto[];
}): void {
  if (opts.categories) {
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
      );
  }
  nock(EONET_BASE)
    .get(`${EONET_API}/events`)
    .query((q) => q.status === 'open')
    .reply(
      200,
      { events: opts.open ?? [] },
      { 'content-type': 'application/json' },
    );
  nock(EONET_BASE)
    .get(`${EONET_API}/events`)
    .query((q) => q.status === 'closed')
    .reply(
      200,
      { events: opts.closed ?? [] },
      { 'content-type': 'application/json' },
    );
}

interface LogRow {
  id: string;
  source: string;
  reference_id: string;
  subscriber_id: string;
  status: string;
  error: string | null;
}

async function logRowsFor(
  dataSource: DataSource,
  subscriberId: string,
): Promise<LogRow[]> {
  return dataSource.query(
    'SELECT id, source, reference_id, subscriber_id, status, error FROM notification_log WHERE subscriber_id = $1 ORDER BY delivered_at ASC',
    [subscriberId],
  );
}

async function allLogRows(
  dataSource: DataSource,
  source?: string,
): Promise<LogRow[]> {
  if (source) {
    return dataSource.query(
      'SELECT id, source, reference_id, subscriber_id, status, error FROM notification_log WHERE source = $1 ORDER BY delivered_at ASC',
      [source],
    );
  }
  return dataSource.query(
    'SELECT id, source, reference_id, subscriber_id, status, error FROM notification_log ORDER BY delivered_at ASC',
  );
}

describe('Fan-out integration (ApodService/EonetService → NotificationService.fanOut)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;
  let originalMockFlag: string | undefined;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    originalMockFlag = process.env.DISABLE_NOTIFICATION_MOCK;
  });

  afterAll(async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = originalMockFlag;
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDb(dataSource);
    await seedCategories(dataSource);
    nock.cleanAll();
    nock.abortPendingRequests();
    // Default to mock mode; real-mode tests flip this locally.
    process.env.DISABLE_NOTIFICATION_MOCK = originalMockFlag ?? 'false';
  });

  // VAL-SCHED-006 (APOD branch): one log row per enabled, apodEnabled subscriber
  it('APOD trigger with N apodEnabled+enabled subscribers → N log rows, distinct subscriber_id × 1', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const s1 = await createSubscriber(context, alice, {
      name: 'A',
      apodEnabled: true,
      enabled: true,
    });
    const s2 = await createSubscriber(context, alice, {
      name: 'B',
      apodEnabled: true,
      enabled: true,
    });
    // apodEnabled=false → excluded
    const s3 = await createSubscriber(context, alice, {
      name: 'C',
      apodEnabled: false,
      enabled: true,
    });
    // enabled=false → excluded
    const s4 = await createSubscriber(context, alice, {
      name: 'D',
      apodEnabled: true,
      enabled: false,
    });

    const today = todayUtc();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today, title: 'Fanout APOD' }), {
        'content-type': 'application/json',
      });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);

    const rows = await allLogRows(dataSource, 'apod');
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.subscriber_id).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());
    expect(rows.every((r) => r.status === 'mocked')).toBe(true);
    expect(rows.every((r) => r.reference_id === today)).toBe(true);
    // Per-subscriber cardinality: 1 row each.
    const grouped: Array<{ subscriber_id: string; count: string }> =
      await dataSource.query(
        "SELECT subscriber_id, COUNT(*)::text AS count FROM notification_log WHERE source='apod' GROUP BY subscriber_id",
      );
    for (const g of grouped) {
      expect(Number(g.count)).toBe(1);
    }
    // Excluded subscribers produced zero rows.
    const s3Rows = await logRowsFor(dataSource, s3.id);
    const s4Rows = await logRowsFor(dataSource, s4.id);
    expect(s3Rows).toHaveLength(0);
    expect(s4Rows).toHaveLength(0);
  });

  // VAL-NOTIF-006: multi-category event fans out exactly once per subscriber
  it('EONET event with [severeStorms, volcanoes] → Sub[severeStorms]×1, Sub[]×1, Sub[wildfires]×0', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const subA = await createSubscriber(context, alice, {
      name: 'A',
      eonetCategorySlugs: ['severeStorms'],
    });
    const subB = await createSubscriber(context, alice, {
      name: 'B',
      eonetCategorySlugs: ['wildfires'],
    });
    const subC = await createSubscriber(context, alice, {
      name: 'C',
      eonetCategorySlugs: [],
    });

    const eventId = 'EONET_MULTI_1';
    nockEonetFetch({
      categories: [
        { id: 'severeStorms', title: 'Severe Storms' },
        { id: 'volcanoes', title: 'Volcanoes' },
      ],
      open: [
        eonetEvent({
          id: eventId,
          title: 'Storm + Volcano',
          categories: [
            { id: 'severeStorms', title: 'Severe Storms' },
            { id: 'volcanoes', title: 'Volcanoes' },
          ],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);
    expect(asFetch(res).detected).toContain(eventId);

    // M2M join has both slugs.
    const links: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM eonet_event_categories WHERE event_id = $1 ORDER BY category_id',
      [eventId],
    );
    expect(links.map((l) => l.category_id)).toEqual([
      'severeStorms',
      'volcanoes',
    ]);

    const aRows = await logRowsFor(dataSource, subA.id);
    const bRows = await logRowsFor(dataSource, subB.id);
    const cRows = await logRowsFor(dataSource, subC.id);
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(0);
    expect(cRows).toHaveLength(1);
    expect(aRows[0].reference_id).toBe(eventId);
    expect(cRows[0].reference_id).toBe(eventId);
    expect(aRows[0].source).toBe('eonet');
    expect(cRows[0].source).toBe('eonet');

    // Per-subscriber cardinality invariant: C (all-categories) gets exactly 1,
    // not 1 per matching category.
    const grouped: Array<{ subscriber_id: string; count: string }> =
      await dataSource.query(
        "SELECT subscriber_id, COUNT(*)::text AS count FROM notification_log WHERE source='eonet' GROUP BY subscriber_id",
      );
    const byId = new Map(
      grouped.map((g) => [g.subscriber_id, Number(g.count)]),
    );
    expect(byId.get(subA.id)).toBe(1);
    expect(byId.get(subC.id)).toBe(1);
  });

  // VAL-CROSS-004: real-mode payload {content, embeds:[{title,url,image?:{url}}]} matches APOD row
  it('real-mode APOD trigger → nocked webhook receives {content, embeds:[{title,url,image:{url}}]} matching the row; row status=sent', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    await createSubscriber(context, alice, { name: 'Real' });

    const today = todayUtc();
    const apod = apodMock({
      date: today,
      title: 'Real APOD',
      url: 'https://example.com/real.jpg',
      media_type: 'image',
    });
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apod, { 'content-type': 'application/json' });

    let capturedBody: { content?: string; embeds?: unknown[] } | undefined;
    const scope = nock(webhookHost)
      .post(webhookPath, (body: unknown) => {
        capturedBody = body as { content?: string; embeds?: unknown[] };
        return true;
      })
      .reply(204);

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);
    expect(scope.isDone()).toBe(true);

    // Payload shape matches the APOD row.
    expect(capturedBody).toBeTruthy();
    expect(typeof capturedBody!.content).toBe('string');
    expect(capturedBody!.content).toContain('Real APOD');
    expect(Array.isArray(capturedBody!.embeds)).toBe(true);
    const embed = (capturedBody!.embeds as Array<Record<string, unknown>>)[0];
    expect(embed.title).toBe('Real APOD');
    expect(embed.url).toBe('https://example.com/real.jpg');
    expect(embed.image).toEqual({ url: 'https://example.com/real.jpg' });

    const rows = await allLogRows(dataSource, 'apod');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].reference_id).toBe(today);
  });

  // VAL-CROSS-004 companion: video APOD → no image field (Discord auto-embeds YouTube)
  it('real-mode video APOD → embed has title+url, no image field', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    await createSubscriber(context, alice, { name: 'Vid' });

    const today = todayUtc();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(
        200,
        apodMock({
          date: today,
          title: 'Video APOD',
          url: 'https://www.youtube.com/watch?v=abc123',
          media_type: 'video',
        }),
        { 'content-type': 'application/json' },
      );

    let capturedBody: { embeds?: Array<Record<string, unknown>> } | undefined;
    nock(webhookHost)
      .post(webhookPath, (body: unknown) => {
        capturedBody = body as {
          embeds?: Array<Record<string, unknown>>;
        };
        return true;
      })
      .reply(204);

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);

    const embed = capturedBody!.embeds![0];
    expect(embed.title).toBe('Video APOD');
    expect(embed.url).toBe('https://www.youtube.com/watch?v=abc123');
    expect(embed.image).toBeUndefined();
  });

  // Failure isolation: webhook 500 → status=failed, error ≤500 chars, trigger 2xx
  it('webhook nocked to 500 → log row status=failed, error ≤500 chars, trigger returns 2xx', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    await createSubscriber(context, alice, { name: 'Fail' });

    const today = todayUtc();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    const longBody = 'x'.repeat(2000);
    nock(webhookHost).post(webhookPath).reply(500, longBody);

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);

    const rows = await allLogRows(dataSource, 'apod');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBeTruthy();
    expect(rows[0].error!.length).toBeLessThanOrEqual(500);
  });

  // VAL-SUB-011: changing category selection immediately reroutes fan-out
  it('VAL-SUB-011: PATCH category selection changes which EONET events fan out', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const s = await createSubscriber(context, alice, {
      name: 'S',
      eonetCategorySlugs: ['wildfires'],
    });

    // First trigger: one wildfires event + one severeStorms event.
    const wId = 'EONET_W_1';
    const ssId = 'EONET_SS_1';
    nockEonetFetch({
      categories: [
        { id: 'wildfires', title: 'Wildfires' },
        { id: 'severeStorms', title: 'Severe Storms' },
      ],
      open: [
        eonetEvent({
          id: wId,
          title: 'Wildfire',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
        }),
        eonetEvent({
          id: ssId,
          title: 'Storm',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
      ],
    });

    const first = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', alice.authHeader);
    expect(first.status).toBe(200);

    // S has [wildfires] → exactly 1 log row, reference_id = wildfires event id.
    const afterFirst = await logRowsFor(dataSource, s.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].reference_id).toBe(wId);

    // PATCH S to [severeStorms].
    const patch = await context.http
      .patch(`/api/subscribers/${s.id}`)
      .set('Authorization', alice.authHeader)
      .send({ eonetCategorySlugs: ['severeStorms'] });
    expect(patch.status).toBe(200);
    expect(asSub(patch).eonetCategorySlugs).toEqual(['severeStorms']);

    // Second trigger: a NEW severeStorms event (old ones are unchanged → no fan-out).
    const ss2Id = 'EONET_SS_2';
    nockEonetFetch({
      open: [
        eonetEvent({
          id: ss2Id,
          title: 'Storm 2',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
      ],
    });

    const second = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', alice.authHeader);
    expect(second.status).toBe(200);

    const afterSecond = await logRowsFor(dataSource, s.id);
    expect(afterSecond).toHaveLength(2);
    // The new row references the severeStorms event id.
    const newRow = afterSecond.find((r) => r.reference_id === ss2Id);
    expect(newRow).toBeDefined();
    expect(newRow!.source).toBe('eonet');
    // The wildfires event id is NOT referenced by the new row.
    const wRef = afterSecond.find((r) => r.reference_id === wId);
    expect(wRef).toBeDefined();
    expect(afterSecond.filter((r) => r.reference_id === wId)).toHaveLength(1);
  });

  // VAL-SCHED-006 (EONET branch) + VAL-NOTIF-005: empty-geometry event persisted, no fan-out
  it('EONET event with empty geometry is persisted but produces no log rows; matching event fans out', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    await createSubscriber(context, alice, {
      name: 'All',
      eonetCategorySlugs: [],
    });

    const geomId = 'EONET_GEOM_OK';
    const emptyId = 'EONET_GEOM_EMPTY';
    nockEonetFetch({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [
        eonetEvent({
          id: geomId,
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
        eonetEvent({
          id: emptyId,
          geometry: [],
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        }),
      ],
    });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);

    // Both events persisted.
    const events: Array<{ id: string }> = await dataSource.query(
      'SELECT id FROM eonet_events WHERE id IN ($1, $2)',
      [geomId, emptyId],
    );
    expect(events.map((e) => e.id).sort()).toEqual([emptyId, geomId].sort());

    const rows = await allLogRows(dataSource, 'eonet');
    expect(rows).toHaveLength(1);
    expect(rows[0].reference_id).toBe(geomId);
    const emptyRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM notification_log WHERE reference_id = $1',
      [emptyId],
    );
    expect(Number(emptyRows[0].count)).toBe(0);
  });

  // VAL-NOTIF-012 (trigger path): zero matching subscribers → zero rows, trigger 2xx
  it('APOD trigger with zero apodEnabled subscribers → zero log rows, trigger 2xx', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    // Only an apodEnabled=false subscriber.
    await createSubscriber(context, alice, { apodEnabled: false });

    const today = todayUtc();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    const res = await context.http
      .post('/api/nasa/triggers/fetch-apod')
      .set('Authorization', alice.authHeader);
    expect(res.status).toBe(200);

    const rows = await allLogRows(dataSource, 'apod');
    expect(rows).toHaveLength(0);
  });
});
