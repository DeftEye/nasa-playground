import nock from 'nock';
import { DataSource } from 'typeorm';
import type { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  type TestAppContext,
} from '../test/utils';
import { todayUtc } from './nasa/apod/apod.service';
import type { NasaApodResponse, EonetEventDto } from './nasa/common';

/**
 * M5 Cross-flow integration specs (`m5-cross-flow-validation-and-prod-serving`).
 *
 * End-to-end happy-path and cross-area assertions exercised against the full
 * NestJS app wired to the test database. NASA HTTP is mocked via `nock`;
 * Discord transport runs in mock mode (default) so `notification_log` rows
 * get `status='mocked'` without real webhook POSTs.
 *
 * Covers: VAL-CROSS-001, VAL-CROSS-002, VAL-CROSS-003, VAL-CROSS-007,
 * VAL-CROSS-008, VAL-CROSS-011, VAL-CROSS-013.
 */

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

const webhookUrl = 'https://discord.com/api/webhooks/999/secret-token-xyz';

interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  maskedWebhookUrl?: string;
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

function apodMock(date: string): NasaApodResponse {
  return {
    title: `APOD ${date}`,
    explanation: 'An explanation.',
    url: 'https://example.com/image.jpg',
    media_type: 'image',
    date,
  };
}

function eonetCategoriesMock() {
  return {
    categories: [
      { id: 'severeStorms', title: 'Severe Storms' },
      { id: 'wildfires', title: 'Wildfires' },
      { id: 'volcanoes', title: 'Volcanoes' },
    ],
  };
}

function eonetEventsMock(): { events: EonetEventDto[] } {
  return {
    events: [
      {
        id: 'EONET_9991',
        title: 'Storm Alpha',
        description: null,
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9991',
        closed: null,
        categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        geometry: [
          {
            type: 'Point',
            date: new Date().toISOString(),
            coordinates: [10, 20],
          },
        ],
      },
      {
        id: 'EONET_9992',
        title: 'Fire Beta',
        description: null,
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9992',
        closed: null,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        geometry: [
          {
            type: 'Point',
            date: new Date().toISOString(),
            coordinates: [30, 40],
          },
        ],
      },
    ],
  };
}

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
  authHeader: Record<string, string>;
}

async function registerAndLogin(
  ctx: TestAppContext,
  email: string,
): Promise<UserContext> {
  const password = 'correct-horse-battery';
  const reg = await ctx.http
    .post('/api/auth/register')
    .send({ email, password });
  expect(reg.status).toBe(201);
  const login = await ctx.http
    .post('/api/auth/login')
    .send({ email, password });
  expect(login.status).toBe(200);
  const accessToken = (login.body as { accessToken: string }).accessToken;
  return {
    userId: (login.body as { user: { id: string } }).user.id,
    accessToken,
    authHeader: { Authorization: `Bearer ${accessToken}` },
  };
}

async function createSubscriber(
  ctx: TestAppContext,
  user: UserContext,
  payload: {
    name: string;
    discordWebhookUrl: string;
    apodEnabled: boolean;
    eonetCategorySlugs: string[];
  },
): Promise<PublicSubscriber> {
  const res = await ctx.http
    .post('/api/subscribers')
    .set(user.authHeader)
    .send(payload);
  expect(res.status).toBe(201);
  return asSub(res);
}

function nockApod(date: string): void {
  nock(NASA_BASE)
    .get(APOD_PATH)
    .query((q) => q.date === date)
    .reply(200, apodMock(date), { 'content-type': 'application/json' });
}

function nockEonetAll(): void {
  nock(EONET_BASE)
    .get(`${EONET_API}/categories`)
    .reply(200, eonetCategoriesMock());
  nock(EONET_BASE)
    .get(`${EONET_API}/events`)
    .query((q) => q.status === 'open')
    .reply(200, eonetEventsMock());
  nock(EONET_BASE)
    .get(`${EONET_API}/events`)
    .query((q) => q.status === 'closed')
    .reply(200, { events: [] });
}

async function getLogCount(
  dataSource: DataSource,
  subscriberId: string,
): Promise<number> {
  const result: Array<{ count: number }> = await dataSource.query(
    'SELECT COUNT(*)::int AS count FROM notification_log WHERE subscriber_id = $1',
    [subscriberId],
  );
  return result[0].count;
}

describe('M5 Cross-Flow Integration (VAL-CROSS-*)', () => {
  let ctx: TestAppContext | undefined;

  beforeEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect(
      (host) => host.includes('127.0.0.1') || host.includes('localhost'),
    );
    ctx = await createTestApp();
    await resetDb(ctx.dataSource);
    await seedCategories(ctx.dataSource);
  });

  afterEach(async () => {
    await closeTestApp(ctx);
    ctx = undefined;
    nock.cleanAll();
  });

  // VAL-CROSS-001: E2E APOD notification round trip
  it('register → login → add subscriber (apodEnabled) → trigger APOD → notification_log row', async () => {
    const user = await registerAndLogin(ctx!, 'alice-cross001@example.com');
    const sub = await createSubscriber(ctx!, user, {
      name: 'Alice APOD sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: [],
    });

    const today = todayUtc();
    nockApod(today);

    const triggerRes = await ctx!.http
      .post('/api/nasa/triggers/fetch-apod')
      .set(user.authHeader);
    expect([200, 201]).toContain(triggerRes.status);

    // Verify notification_log row exists
    const count = await getLogCount(ctx!.dataSource, sub.id);
    expect(count).toBe(1);

    // Verify the row details
    const rows: Array<{
      source: string;
      reference_id: string;
      status: string;
    }> = await ctx!.dataSource.query(
      'SELECT source, reference_id, status FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(rows[0].source).toBe('apod');
    expect(rows[0].reference_id).toBe(today);
    expect(rows[0].status).toBe('mocked');

    // Verify FE can see it via GET /api/notifications
    const notifRes = await ctx!.http
      .get('/api/notifications')
      .set(user.authHeader);
    expect(notifRes.status).toBe(200);
    const notifs = notifRes.body as Array<{
      source: string;
      referenceId: string;
      status: string;
    }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].source).toBe('apod');
    expect(notifs[0].referenceId).toBe(today);
    expect(notifs[0].status).toBe('mocked');
  });

  // VAL-CROSS-002: E2E EONET notification path with single category
  it('subscriber with [severeStorms] → trigger EONET → log row; subscriber with [wildfires] → no row for severeStorms event', async () => {
    const stormUser = await registerAndLogin(ctx!, 'storm@example.com');
    const stormSub = await createSubscriber(ctx!, stormUser, {
      name: 'Storm sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: false,
      eonetCategorySlugs: ['severeStorms'],
    });

    const fireUser = await registerAndLogin(ctx!, 'fire@example.com');
    const fireSub = await createSubscriber(ctx!, fireUser, {
      name: 'Fire sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: false,
      eonetCategorySlugs: ['wildfires'],
    });

    nockEonetAll();

    const triggerRes = await ctx!.http
      .post('/api/nasa/triggers/fetch-eonet')
      .set(stormUser.authHeader);
    expect([200, 201]).toContain(triggerRes.status);
    const fetchResult = asFetch(triggerRes);
    expect(fetchResult.detected).toContain('EONET_9991');
    expect(fetchResult.detected).toContain('EONET_9992');

    // Storm subscriber should get a row for EONET_9991 (severeStorms event)
    const stormCount = await getLogCount(ctx!.dataSource, stormSub.id);
    expect(stormCount).toBe(1);

    const stormRows: Array<{ reference_id: string }> =
      await ctx!.dataSource.query(
        'SELECT reference_id FROM notification_log WHERE subscriber_id = $1',
        [stormSub.id],
      );
    expect(stormRows[0].reference_id).toBe('EONET_9991');

    // Fire subscriber should get a row for EONET_9992 (wildfires event), NOT EONET_9991
    const fireCount = await getLogCount(ctx!.dataSource, fireSub.id);
    expect(fireCount).toBe(1);

    const fireRows: Array<{ reference_id: string }> =
      await ctx!.dataSource.query(
        'SELECT reference_id FROM notification_log WHERE subscriber_id = $1',
        [fireSub.id],
      );
    expect(fireRows[0].reference_id).toBe('EONET_9992');
  });

  // VAL-CROSS-003: Multi-user subscriber isolation (E2E)
  it('Bob GET excludes Alice subscriber; Bob PATCH/DELETE on Alice id → 404', async () => {
    const alice = await registerAndLogin(ctx!, 'alice-isolation@example.com');
    const bob = await registerAndLogin(ctx!, 'bob-isolation@example.com');

    const aliceSub = await createSubscriber(ctx!, alice, {
      name: 'Alice sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });

    // Bob creates his own subscriber
    const bobSub = await createSubscriber(ctx!, bob, {
      name: 'Bob sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: false,
      eonetCategorySlugs: ['wildfires'],
    });

    // Bob's GET should only show his own subscriber
    const bobListRes = await ctx!.http
      .get('/api/subscribers')
      .set(bob.authHeader);
    expect(bobListRes.status).toBe(200);
    const bobSubs = bobListRes.body as PublicSubscriber[];
    expect(bobSubs).toHaveLength(1);
    expect(bobSubs[0].id).toBe(bobSub.id);
    expect(bobSubs.map((s) => s.id)).not.toContain(aliceSub.id);

    // Bob's PATCH on Alice's subscriber → 404
    const patchRes = await ctx!.http
      .patch(`/api/subscribers/${aliceSub.id}`)
      .set(bob.authHeader)
      .send({ name: 'hacked' });
    expect(patchRes.status).toBe(404);

    // Bob's DELETE on Alice's subscriber → 404
    const delRes = await ctx!.http
      .delete(`/api/subscribers/${aliceSub.id}`)
      .set(bob.authHeader);
    expect(delRes.status).toBe(404);

    // Alice's subscriber is unchanged
    const aliceListRes = await ctx!.http
      .get('/api/subscribers')
      .set(alice.authHeader);
    expect(aliceListRes.status).toBe(200);
    const aliceSubs = aliceListRes.body as PublicSubscriber[];
    expect(aliceSubs).toHaveLength(1);
    expect(aliceSubs[0].id).toBe(aliceSub.id);
    expect(aliceSubs[0].name).toBe('Alice sub');
  });

  // VAL-CROSS-007: Consequential subscriber toggles (enabled and apodEnabled)
  it('enabled=true→false suppresses fan-out; re-enable resumes', async () => {
    const user = await registerAndLogin(ctx!, 'toggle@example.com');
    const sub = await createSubscriber(ctx!, user, {
      name: 'Toggle sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: [],
    });

    // Step 1: enabled=true, apodEnabled=true → trigger APOD → 1 row
    nockApod(todayUtc());
    await ctx!.http.post('/api/nasa/triggers/fetch-apod').set(user.authHeader);
    expect(await getLogCount(ctx!.dataSource, sub.id)).toBe(1);

    // Step 2: PATCH enabled=false → trigger APOD → 0 new rows
    await ctx!.http
      .patch(`/api/subscribers/${sub.id}`)
      .set(user.authHeader)
      .send({ enabled: false });
    nockApod(todayUtc());
    await ctx!.http.post('/api/nasa/triggers/fetch-apod').set(user.authHeader);
    expect(await getLogCount(ctx!.dataSource, sub.id)).toBe(1); // still 1, no new row

    // Step 3: re-enable → trigger APOD → 1 new row (total 2)
    await ctx!.http
      .patch(`/api/subscribers/${sub.id}`)
      .set(user.authHeader)
      .send({ enabled: true });
    nockApod(todayUtc());
    await ctx!.http.post('/api/nasa/triggers/fetch-apod').set(user.authHeader);
    expect(await getLogCount(ctx!.dataSource, sub.id)).toBe(2);
  });

  // VAL-CROSS-008: DELETE /api/auth/me cascades to user data
  it('DELETE /api/auth/me cascades to subscribers, subscriber_categories, notification_log', async () => {
    const user = await registerAndLogin(ctx!, 'cascade@example.com');
    const sub = await createSubscriber(ctx!, user, {
      name: 'Cascade sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });

    // Trigger APOD to create a notification_log row
    nockApod(todayUtc());
    await ctx!.http.post('/api/nasa/triggers/fetch-apod').set(user.authHeader);
    expect(await getLogCount(ctx!.dataSource, sub.id)).toBe(1);

    // DELETE /api/auth/me → 204
    const delRes = await ctx!.http.delete('/api/auth/me').set(user.authHeader);
    expect(delRes.status).toBe(204);

    // Verify cascade: users row gone
    const userRows: Array<{ count: number }> = await ctx!.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE id = $1',
      [user.userId],
    );
    expect(userRows[0].count).toBe(0);

    // subscribers gone
    const subRows: Array<{ count: number }> = await ctx!.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM subscribers WHERE owner_id = $1',
      [user.userId],
    );
    expect(subRows[0].count).toBe(0);

    // subscriber_categories gone
    const catRows: Array<{ count: number }> = await ctx!.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(catRows[0].count).toBe(0);

    // notification_log gone
    const logRows: Array<{ count: number }> = await ctx!.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(logRows[0].count).toBe(0);
  });

  // VAL-CROSS-011: Webhook URL privacy in list responses and logs
  it('GET /api/subscribers body has no discordWebhookUrl; notification_log payload has redacted form only', async () => {
    const user = await registerAndLogin(ctx!, 'privacy@example.com');
    await createSubscriber(ctx!, user, {
      name: 'Privacy sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: [],
    });

    // GET /api/subscribers — no discordWebhookUrl key
    const listRes = await ctx!.http
      .get('/api/subscribers')
      .set(user.authHeader);
    expect(listRes.status).toBe(200);
    const subs = listRes.body as PublicSubscriber[];
    expect(subs).toHaveLength(1);
    expect(subs[0]).not.toHaveProperty('discordWebhookUrl');
    // Should have maskedWebhookUrl
    expect(subs[0].maskedWebhookUrl).toMatch(/\/webhooks\/\.\.\.\/[\w-]+$/);

    // Trigger APOD to create a notification_log row
    nockApod(todayUtc());
    await ctx!.http.post('/api/nasa/triggers/fetch-apod').set(user.authHeader);

    // Check notification_log payload — no raw webhook URL
    const logRows: Array<{ payload_text: string }> =
      await ctx!.dataSource.query(
        'SELECT payload::text AS payload_text FROM notification_log',
      );
    expect(logRows.length).toBeGreaterThan(0);
    for (const row of logRows) {
      expect(row.payload_text).not.toContain('discord.com/api/webhooks');
      expect(row.payload_text).not.toContain('secret-token-xyz');
    }

    // Verify the raw URL exists only in subscribers table
    const subRows: Array<{ discord_webhook_url: string }> =
      await ctx!.dataSource.query(
        'SELECT discord_webhook_url FROM subscribers',
      );
    expect(subRows[0].discord_webhook_url).toBe(webhookUrl);
  });

  // VAL-CROSS-013: Fresh user with zero subscribers — empty notification history
  it('fresh user with zero subscribers → notification_log has zero rows; GET /api/notifications returns []', async () => {
    const user = await registerAndLogin(ctx!, 'fresh@example.com');

    // Trigger APOD (with no subscribers, fan-out writes 0 rows)
    nockApod(todayUtc());
    const triggerRes = await ctx!.http
      .post('/api/nasa/triggers/fetch-apod')
      .set(user.authHeader);
    expect([200, 201]).toContain(triggerRes.status);

    // No notification_log rows for this user
    const logRows: Array<{ count: number }> = await ctx!.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM notification_log nl
       JOIN subscribers s ON nl.subscriber_id = s.id
       WHERE s.owner_id = $1`,
      [user.userId],
    );
    expect(logRows[0].count).toBe(0);

    // GET /api/notifications returns []
    const notifRes = await ctx!.http
      .get('/api/notifications')
      .set(user.authHeader);
    expect(notifRes.status).toBe(200);
    expect(notifRes.body).toEqual([]);
  });

  // VAL-CROSS-011 extended: category toggle immediately reroutes fan-out
  it('changing eonetCategorySlugs immediately reroutes fan-out for new events', async () => {
    const user = await registerAndLogin(ctx!, 'reroute@example.com');
    const sub = await createSubscriber(ctx!, user, {
      name: 'Reroute sub',
      discordWebhookUrl: webhookUrl,
      apodEnabled: false,
      eonetCategorySlugs: ['wildfires'],
    });

    // First EONET trigger: subscriber matches wildfires event only
    nockEonetAll();
    await ctx!.http.post('/api/nasa/triggers/fetch-eonet').set(user.authHeader);

    let rows: Array<{ reference_id: string }> = await ctx!.dataSource.query(
      'SELECT reference_id FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference_id).toBe('EONET_9992'); // wildfires event

    // PATCH to severeStorms
    // Need to clean nock and re-setup for second trigger
    nock.cleanAll();
    nock.enableNetConnect(
      (host) => host.includes('127.0.0.1') || host.includes('localhost'),
    );

    await ctx!.http
      .patch(`/api/subscribers/${sub.id}`)
      .set(user.authHeader)
      .send({ eonetCategorySlugs: ['severeStorms'] });

    // Second EONET trigger with new events
    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(200, eonetCategoriesMock());
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'open')
      .reply(200, {
        events: [
          {
            id: 'EONET_9993',
            title: 'Storm Gamma',
            description: null,
            link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9993',
            closed: null,
            categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
            geometry: [
              {
                type: 'Point',
                date: new Date().toISOString(),
                coordinates: [50, 60],
              },
            ],
          },
        ],
      });
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'closed')
      .reply(200, { events: [] });

    await ctx!.http.post('/api/nasa/triggers/fetch-eonet').set(user.authHeader);

    // Now subscriber should have 2 rows: old wildfires + new severeStorms
    rows = await ctx!.dataSource.query(
      'SELECT reference_id FROM notification_log WHERE subscriber_id = $1 ORDER BY delivered_at',
      [sub.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].reference_id).toBe('EONET_9993'); // new severeStorms event
  });
});
