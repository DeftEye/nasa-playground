import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import nock from 'nock';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';
import { NotificationService } from './notifications.service';
import { Subscriber } from '../subscribers/entities/subscriber.entity';

/**
 * Integration specs for `NotificationsModule` covering VAL-NOTIF-001..004,
 * VAL-NOTIF-007..013. VAL-NOTIF-005 (EONET empty-geometry skip) and
 * VAL-NOTIF-006 (multi-category per-subscriber cardinality) require the
 * ApodService/EonetService → fanOut wiring delivered in the companion M3
 * feature `m3-fanout-integration-and-real-discord`; a contract-boundary test
 * for VAL-NOTIF-005 is included here and the full E2E is noted in the handoff.
 */

interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  createdAt: string;
}

interface PublicNotification {
  id: string;
  deliveredAt: string;
  source: string;
  referenceId: string;
  subscriberId: string;
  status: string;
  payload: Record<string, unknown>;
  error: string | null;
}

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

const asSub = (res: Response): PublicSubscriber => res.body as PublicSubscriber;
const asNotifList = (res: Response): PublicNotification[] =>
  res.body as PublicNotification[];
const asError = (res: Response): ErrorBody => res.body as ErrorBody;

const validWebhookUrl =
  'https://discord.com/api/webhooks/1234567890/abcdef123456';
const webhookHost = 'https://discord.com';
const webhookPath = '/api/webhooks/1234567890/abcdef123456';

const seedCategories = async (dataSource: DataSource): Promise<void> => {
  await dataSource.query(
    `INSERT INTO eonet_categories (id, title, description) VALUES
      ('severeStorms', 'Severe Storms', NULL),
      ('wildfires', 'Wildfires', NULL),
      ('volcanoes', 'Volcanoes', NULL)
    ON CONFLICT (id) DO NOTHING`,
  );
};

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

async function createSubscriberFor(
  context: TestAppContext,
  user: UserContext,
  overrides: Partial<{
    name: string;
    enabled: boolean;
    apodEnabled: boolean;
    eonetCategorySlugs: string[];
  }> = {},
): Promise<Subscriber> {
  const res = await context.http
    .post('/api/subscribers')
    .set('Authorization', user.authHeader)
    .send({
      name: overrides.name ?? 'Sub',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: overrides.apodEnabled ?? true,
      enabled: overrides.enabled ?? true,
      eonetCategorySlugs: overrides.eonetCategorySlugs ?? [],
    });
  expect(res.status).toBe(201);
  const subId = asSub(res).id;
  // Load the full entity (with discordWebhookUrl) for fanOut.
  const repo = context.dataSource.getRepository(Subscriber);
  return repo.findOneByOrFail({ id: subId });
}

const apodPayload = {
  content: 'New APOD: A Test Image',
  embeds: [
    {
      title: 'A Test Image',
      url: 'https://example.com/apod',
      image: { url: 'https://example.com/apod.jpg' },
    },
  ],
};

describe('Notifications (integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;
  let notifications: NotificationService;
  let originalMockFlag: string | undefined;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    notifications = context.app.get(NotificationService);
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
    // Default to mock mode for each test; real-mode tests flip this locally.
    process.env.DISABLE_NOTIFICATION_MOCK = originalMockFlag ?? 'false';
  });

  // ---------- fanOut primitives ----------

  // VAL-NOTIF-001
  it('mock mode fan-out writes notification_log rows with status=mocked and no Discord POST', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice, {
      apodEnabled: true,
    });

    // Scope nock to discord.com to prove NO request is made in mock mode.
    const discordScope = nock(webhookHost).post(webhookPath).reply(204);

    await notifications.fanOut([sub], apodPayload, 'apod', '2026-07-22');

    expect(discordScope.isDone()).toBe(false);

    const rows: Array<{
      source: string;
      status: string;
      reference_id: string;
      subscriber_id: string;
    }> = await dataSource.query(
      'SELECT source, status, reference_id, subscriber_id FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('apod');
    expect(rows[0].status).toBe('mocked');
    expect(rows[0].reference_id).toBe('2026-07-22');
  });

  // VAL-NOTIF-002
  it('real mode sends one webhook POST and writes status=sent on 2xx', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    const scope = nock(webhookHost)
      .post(webhookPath, {
        content: apodPayload.content,
        embeds: apodPayload.embeds,
      })
      .reply(204);

    await notifications.fanOut([sub], apodPayload, 'apod', '2026-07-22');

    expect(scope.isDone()).toBe(true);

    const rows: Array<{
      status: string;
      reference_id: string;
      delivered_at: Date;
    }> = await dataSource.query(
      'SELECT status, reference_id, delivered_at FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].reference_id).toBe('2026-07-22');
    expect(rows[0].delivered_at).toBeTruthy();
  });

  // VAL-NOTIF-003
  it('non-2xx Discord response → status=failed, error ≤500 chars, row written', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    const longBody = 'x'.repeat(2000);
    const scope = nock(webhookHost).post(webhookPath).reply(500, longBody);

    await notifications.fanOut([sub], apodPayload, 'apod', '2026-07-22');

    expect(scope.isDone()).toBe(true);

    const rows: Array<{
      status: string;
      error: string;
      delivered_at: Date;
    }> = await dataSource.query(
      'SELECT status, error, delivered_at FROM notification_log WHERE subscriber_id = $1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBeTruthy();
    expect(rows[0].error.length).toBeLessThanOrEqual(500);
    expect(rows[0].delivered_at).toBeTruthy();
  });

  // VAL-NOTIF-004
  it('fan-out writes exactly one log row per target subscriber; disabled subscribers excluded by caller', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const s1 = await createSubscriberFor(context, alice, {
      name: 'A',
      apodEnabled: true,
    });
    const s2 = await createSubscriberFor(context, alice, {
      name: 'B',
      apodEnabled: true,
    });
    const s3 = await createSubscriberFor(context, alice, {
      name: 'C',
      apodEnabled: true,
    });

    await notifications.fanOut([s1, s2, s3], apodPayload, 'apod', '2026-07-22');

    const rows: Array<{ subscriber_id: string }> = await dataSource.query(
      "SELECT subscriber_id FROM notification_log WHERE source='apod' AND reference_id='2026-07-22'",
    );
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.subscriber_id).sort();
    expect(ids).toEqual([s1.id, s2.id, s3.id].sort());
    // Each subscriber has exactly one row.
    const grouped: Array<{ subscriber_id: string; count: string }> =
      await dataSource.query(
        "SELECT subscriber_id, COUNT(*)::text AS count FROM notification_log WHERE source='apod' AND reference_id='2026-07-22' GROUP BY subscriber_id",
      );
    for (const g of grouped) {
      expect(Number(g.count)).toBe(1);
    }
  });

  // VAL-NOTIF-005 (contract boundary): fanOut writes a row only for the
  // referenceId it is invoked with; an empty-geometry EONET event whose caller
  // does NOT invoke fanOut produces zero log rows for that event id. The full
  // EONET→fanOut exclusion wiring lands in `m3-fanout-integration-and-real-discord`.
  it('fanOut does not fabricate rows for referenceIds it was not invoked with (empty-geometry boundary)', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice, {
      eonetCategorySlugs: ['wildfires'],
    });

    // Simulate a non-empty-geometry event → fanOut invoked.
    await notifications.fanOut([sub], apodPayload, 'eonet', 'EONET_HAS_GEOM');
    // Simulate an empty-geometry event → caller skips fanOut (no invocation).
    // No row should exist for EONET_NO_GEOM.
    const rows: Array<{ reference_id: string }> = await dataSource.query(
      'SELECT reference_id FROM notification_log WHERE subscriber_id=$1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference_id).toBe('EONET_HAS_GEOM');
    const noGeom: Array<{ count: string }> = await dataSource.query(
      "SELECT COUNT(*)::text AS count FROM notification_log WHERE subscriber_id=$1 AND reference_id='EONET_NO_GEOM'",
      [sub.id],
    );
    expect(Number(noGeom[0].count)).toBe(0);
  });

  // VAL-NOTIF-007
  it('notification_log.payload never contains the raw webhook URL (redacted form only)', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    await notifications.fanOut([sub], apodPayload, 'apod', '2026-07-22');

    const rows: Array<{ payload: string }> = await dataSource.query(
      'SELECT payload::text AS payload FROM notification_log WHERE subscriber_id=$1',
      [sub.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).not.toMatch(
      /discord\.com\/api\/webhooks\/1234567890\/abcdef123456/,
    );
    expect(rows[0].payload).toMatch(/\/webhooks\/\.\.\.\/3456/);
  });

  // VAL-NOTIF-008
  it('transport socket error is isolated: fanOut does not throw, row status=failed', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    // Force a connection error by pointing nock to abort the request.
    nock(webhookHost).post(webhookPath).replyWithError('socket hang up');

    // Must not throw; returns an array (the failed row included).
    const result = await notifications.fanOut(
      [sub],
      apodPayload,
      'eonet',
      'EONET_1',
    );
    expect(Array.isArray(result)).toBe(true);

    const rows: Array<{ status: string; error: string }> =
      await dataSource.query(
        'SELECT status, error FROM notification_log WHERE subscriber_id=$1',
        [sub.id],
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBeTruthy();
  });

  // VAL-NOTIF-012
  it('zero-subscriber fan-out writes zero rows and returns silently', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const before: Array<{ count: string }> = await dataSource.query(
      "SELECT COUNT(*)::text AS count FROM notification_log WHERE source='apod'",
    );
    const beforeCount = Number(before[0].count);

    const rows = await notifications.fanOut(
      [],
      apodPayload,
      'apod',
      '2026-07-22',
    );
    expect(rows).toEqual([]);

    const after: Array<{ count: string }> = await dataSource.query(
      "SELECT COUNT(*)::text AS count FROM notification_log WHERE source='apod'",
    );
    expect(Number(after[0].count)).toBe(beforeCount);
  });

  // VAL-NOTIF-013
  it('Discord transport does not retry: exactly one POST and one log row on 500', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    const scope = nock(webhookHost).post(webhookPath).reply(500);

    await notifications.fanOut([sub], apodPayload, 'apod', '2026-07-22');

    expect(scope.isDone()).toBe(true);
    // Exactly one interceptor was declared and consumed; no extras pending.
    expect(nock.pendingMocks()).toEqual([]);

    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM notification_log WHERE subscriber_id=$1',
      [sub.id],
    );
    expect(Number(rows[0].count)).toBe(1);
    const status: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM notification_log WHERE subscriber_id=$1',
      [sub.id],
    );
    expect(status[0].status).toBe('failed');
  });

  // ---------- GET /api/notifications ----------

  // VAL-NOTIF-009
  it('GET /api/notifications is scoped to the requesting user; payload redacted; shape correct', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const bob = await registerAndLogin(context, 'bob@example.com');
    const aliceSub = await createSubscriberFor(context, alice, {
      name: 'Alice Sub',
    });
    const bobSub = await createSubscriberFor(context, bob, { name: 'Bob Sub' });

    await notifications.fanOut([aliceSub], apodPayload, 'apod', '2026-07-22');
    await notifications.fanOut(
      [bobSub],
      { content: 'bob eonet', embeds: [] },
      'eonet',
      'EONET_B',
    );

    const aliceRes = await context.http
      .get('/api/notifications')
      .set('Authorization', alice.authHeader);
    expect(aliceRes.status).toBe(200);
    const aliceRows = asNotifList(aliceRes);
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].subscriberId).toBe(aliceSub.id);
    expect(['apod', 'eonet', 'test']).toContain(aliceRows[0].source);
    expect(['sent', 'mocked', 'failed']).toContain(aliceRows[0].status);
    expect(aliceRows[0].payload).toBeTruthy();
    // Shape: required keys present.
    expect(aliceRows[0].id).toEqual(expect.any(String));
    expect(aliceRows[0].deliveredAt).toEqual(expect.any(String));
    expect(aliceRows[0].referenceId).toBe('2026-07-22');
    // No raw webhook URL in the response body.
    expect(JSON.stringify(aliceRes.body)).not.toMatch(
      /discord\.com\/api\/webhooks\/1234567890\/abcdef123456/,
    );
    expect(JSON.stringify(aliceRows[0].payload)).toMatch(
      /\/webhooks\/\.\.\.\/3456/,
    );

    // Bob sees only his own row, never Alice's subscriber id.
    const bobRes = await context.http
      .get('/api/notifications')
      .set('Authorization', bob.authHeader);
    expect(bobRes.status).toBe(200);
    const bobRows = asNotifList(bobRes);
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0].subscriberId).toBe(bobSub.id);
    expect(bobRows.map((r) => r.subscriberId)).not.toContain(aliceSub.id);
  });

  // VAL-NOTIF-009 companion: unauthenticated → 401
  it('GET /api/notifications without JWT → 401', async () => {
    const res = await context.http.get('/api/notifications');
    expect(res.status).toBe(401);
  });

  // VAL-NOTIF-010
  it('filters by source and status (individually + combined) with stable disjoint pagination', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    // Build a deterministic dataset: 3 apod/mocked + 2 eonet/failed (via real mode nock).
    for (let i = 0; i < 3; i += 1) {
      await notifications.fanOut([sub], apodPayload, 'apod', `apod-${i}`);
    }
    process.env.DISABLE_NOTIFICATION_MOCK = 'true';
    for (let i = 0; i < 2; i += 1) {
      nock(webhookHost).post(webhookPath).reply(500, 'boom');
      await notifications.fanOut(
        [sub],
        { content: 'eonet', embeds: [] },
        'eonet',
        `eonet-${i}`,
      );
    }
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';

    // Source filter: only apod rows.
    const apodOnly = await context.http
      .get('/api/notifications?source=apod')
      .set('Authorization', alice.authHeader);
    expect(apodOnly.status).toBe(200);
    expect(asNotifList(apodOnly).every((r) => r.source === 'apod')).toBe(true);
    expect(asNotifList(apodOnly)).toHaveLength(3);

    // Status filter: only failed rows.
    const failedOnly = await context.http
      .get('/api/notifications?status=failed')
      .set('Authorization', alice.authHeader);
    expect(failedOnly.status).toBe(200);
    expect(asNotifList(failedOnly).every((r) => r.status === 'failed')).toBe(
      true,
    );
    expect(asNotifList(failedOnly)).toHaveLength(2);

    // Combined filter: intersection.
    const combined = await context.http
      .get('/api/notifications?source=eonet&status=failed')
      .set('Authorization', alice.authHeader);
    expect(combined.status).toBe(200);
    const combinedRows = asNotifList(combined);
    expect(combinedRows.every((r) => r.source === 'eonet')).toBe(true);
    expect(combinedRows.every((r) => r.status === 'failed')).toBe(true);
    expect(combinedRows).toHaveLength(2);

    // Pagination disjointness: page 1 and page 2 of limit=2 across all rows.
    const page1 = await context.http
      .get('/api/notifications?page=1&limit=2')
      .set('Authorization', alice.authHeader);
    const page2 = await context.http
      .get('/api/notifications?page=2&limit=2')
      .set('Authorization', alice.authHeader);
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    const p1 = asNotifList(page1);
    const p2 = asNotifList(page2);
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(2);
    const p1Ids = new Set(p1.map((r) => r.id));
    const p2Ids = new Set(p2.map((r) => r.id));
    // Disjoint pages.
    for (const id of p2Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }
    // Union of the two pages (4 rows) is a subset of the full 5-row dataset,
    // and the remaining row appears on page 3.
    const page3 = await context.http
      .get('/api/notifications?page=3&limit=2')
      .set('Authorization', alice.authHeader);
    const p3 = asNotifList(page3);
    expect(p3).toHaveLength(1);
    const allIds = new Set([...p1Ids, ...p2Ids, ...p3.map((r) => r.id)]);
    const full = await context.http
      .get('/api/notifications?limit=100')
      .set('Authorization', alice.authHeader);
    expect(
      asNotifList(full)
        .map((r) => r.id)
        .sort(),
    ).toEqual([...allIds].sort());
  });

  // VAL-NOTIF-011
  it('pagination defaults (limit=20), max enforced (?limit=200 → 400), over-page → [] (200)', async () => {
    process.env.DISABLE_NOTIFICATION_MOCK = 'false';
    const alice = await registerAndLogin(context, 'alice@example.com');
    const sub = await createSubscriberFor(context, alice);

    // Seed 25 rows so the default limit of 20 returns exactly 20.
    for (let i = 0; i < 25; i += 1) {
      await notifications.fanOut([sub], apodPayload, 'apod', `d-${i}`);
    }

    const def = await context.http
      .get('/api/notifications')
      .set('Authorization', alice.authHeader);
    expect(def.status).toBe(200);
    expect(asNotifList(def)).toHaveLength(20);

    // limit=200 exceeds max 100 → 400.
    const tooMany = await context.http
      .get('/api/notifications?limit=200')
      .set('Authorization', alice.authHeader);
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(asError(tooMany).message)).toMatch(/limit/i);

    // Over-page beyond the last non-empty page → [] (200).
    const overPage = await context.http
      .get('/api/notifications?page=100&limit=20')
      .set('Authorization', alice.authHeader);
    expect(overPage.status).toBe(200);
    expect(asNotifList(overPage)).toEqual([]);
  });

  // VAL-NOTIF-011 companion: invalid source/status → 400
  it('rejects invalid source and status query values with 400', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const badSource = await context.http
      .get('/api/notifications?source=bogus')
      .set('Authorization', alice.authHeader);
    expect(badSource.status).toBe(400);
    const badStatus = await context.http
      .get('/api/notifications?status=bogus')
      .set('Authorization', alice.authHeader);
    expect(badStatus.status).toBe(400);
  });
});
