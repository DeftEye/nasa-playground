import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../test/utils';

/**
 * Integration specs for `SubscribersModule` covering VAL-SUB-001..010 and
 * VAL-SUB-012..014. VAL-SUB-011 (category-change → fan-out routing) requires
 * the EONET→NotificationService fan-out wiring delivered in a separate M3
 * feature (`m3-fanout-integration-and-real-discord`); it is intentionally
 * out of scope for this spec and noted in the feature handoff.
 */

interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  createdAt: string;
}

interface TestNotificationResponse {
  id: string;
}

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

const asSub = (res: Response): PublicSubscriber => res.body as PublicSubscriber;
const asSubList = (res: Response): PublicSubscriber[] =>
  res.body as PublicSubscriber[];
const asTest = (res: Response): TestNotificationResponse =>
  res.body as TestNotificationResponse;
const asError = (res: Response): ErrorBody => res.body as ErrorBody;

const seedCategories = async (dataSource: DataSource): Promise<void> => {
  await dataSource.query(
    `INSERT INTO eonet_categories (id, title, description) VALUES
      ('severeStorms', 'Severe Storms', NULL),
      ('wildfires', 'Wildfires', NULL),
      ('volcanoes', 'Volcanoes', NULL)
    ON CONFLICT (id) DO NOTHING`,
  );
};

const validWebhookUrl =
  'https://discord.com/api/webhooks/1234567890/abcdef123456';

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

const createSubscriber = (
  context: TestAppContext,
  user: UserContext,
  body: Record<string, unknown>,
) =>
  context.http
    .post('/api/subscribers')
    .set('Authorization', user.authHeader)
    .send(body);

describe('Subscribers (integration)', () => {
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
    await seedCategories(dataSource);
  });

  // VAL-SUB-001
  it('creates a subscriber (201), omits discordWebhookUrl, stores ownerId + M2M row', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const res = await createSubscriber(context, alice, {
      name: 'Alice Sub',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    expect(res.status).toBe(201);
    const body = asSub(res);
    expect(body.id).toEqual(expect.any(String));
    expect(body.name).toBe('Alice Sub');
    expect(body.apodEnabled).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.eonetCategorySlugs).toEqual(['severeStorms']);
    expect(typeof body.createdAt).toBe('string');
    // No webhook URL in the response body.
    expect(JSON.stringify(res.body)).not.toMatch(/discordWebhookUrl/);
    expect(JSON.stringify(res.body)).not.toMatch(validWebhookUrl);

    // psql: subscriber row has owner_id = alice, stores the true URL.
    const subRows: Array<{
      owner_id: string;
      discord_webhook_url: string;
    }> = await dataSource.query(
      'SELECT owner_id, discord_webhook_url FROM subscribers WHERE id = $1',
      [body.id],
    );
    expect(subRows).toHaveLength(1);
    expect(subRows[0].owner_id).toBe(alice.userId);
    expect(subRows[0].discord_webhook_url).toBe(validWebhookUrl);

    // M2M row links to severeStorms.
    const joinRows: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM subscriber_categories WHERE subscriber_id = $1',
      [body.id],
    );
    expect(joinRows.map((r) => r.category_id).sort()).toEqual(['severeStorms']);
  });

  // VAL-SUB-002
  it('rejects a malformed webhook URL with 400 and inserts no row', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const res = await createSubscriber(context, alice, {
      name: 'Bad URL',
      discordWebhookUrl: 'not-a-url',
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(asError(res).message)).toMatch(/discordWebhookUrl/i);

    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscribers WHERE owner_id = $1',
      [alice.userId],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  // VAL-SUB-003
  it('requires JWT: POST /api/subscribers without Authorization → 401, no row', async () => {
    const res = await context.http.post('/api/subscribers').send({
      name: 'Anon',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    expect(res.status).toBe(401);
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscribers',
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  // VAL-SUB-004
  it('lists subscribers scoped to the requesting user, omits webhookUrl', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const bob = await registerAndLogin(context, 'bob@example.com');

    const a1 = await createSubscriber(context, alice, {
      name: 'Alice 1',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    expect(a1.status).toBe(201);
    const a2 = await createSubscriber(context, alice, {
      name: 'Alice 2',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: false,
      eonetCategorySlugs: ['wildfires', 'volcanoes'],
    });
    expect(a2.status).toBe(201);
    const b1 = await createSubscriber(context, bob, {
      name: 'Bob 1',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: [],
    });
    expect(b1.status).toBe(201);

    const aliceList = await context.http
      .get('/api/subscribers')
      .set('Authorization', alice.authHeader);
    expect(aliceList.status).toBe(200);
    const aliceSubs = asSubList(aliceList);
    expect(aliceSubs).toHaveLength(2);
    expect(aliceSubs.map((s) => s.id).sort()).toEqual(
      [asSub(a1).id, asSub(a2).id].sort(),
    );
    expect(JSON.stringify(aliceSubs)).not.toMatch(/discordWebhookUrl/);
    expect(JSON.stringify(aliceSubs)).not.toMatch(validWebhookUrl);

    const bobList = await context.http
      .get('/api/subscribers')
      .set('Authorization', bob.authHeader);
    expect(bobList.status).toBe(200);
    const bobSubs = asSubList(bobList);
    expect(bobSubs).toHaveLength(1);
    expect(bobSubs[0].id).toBe(asSub(b1).id);
    // Bob cannot see Alice's subscriber ids.
    expect(bobSubs.map((s) => s.id)).not.toContain(asSub(a1).id);
    expect(bobSubs.map((s) => s.id)).not.toContain(asSub(a2).id);
  });

  // VAL-SUB-005
  it('PATCH replaces M2M categories with no stale or duplicate rows', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Patch Me',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    expect(created.status).toBe(201);
    const subId = asSub(created).id;

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader)
      .send({ eonetCategorySlugs: ['severeStorms', 'wildfires'] });
    expect(res.status).toBe(200);
    expect(asSub(res).eonetCategorySlugs.sort()).toEqual([
      'severeStorms',
      'wildfires',
    ]);

    const joinRows: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(joinRows.map((r) => r.category_id).sort()).toEqual([
      'severeStorms',
      'wildfires',
    ]);
    // No duplicates.
    expect(joinRows.length).toBe(2);
  });

  // VAL-SUB-006
  it('PATCH with empty category array clears M2M rows (means "all events")', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Clear Me',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms', 'wildfires'],
    });
    const subId = asSub(created).id;

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader)
      .send({ eonetCategorySlugs: [] });
    expect(res.status).toBe(200);
    expect(asSub(res).eonetCategorySlugs).toEqual([]);

    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  // VAL-SUB-007
  it('PATCH on another user subscriber returns 404; row unchanged', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const bob = await registerAndLogin(context, 'bob@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Alice Only',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', bob.authHeader)
      .send({ name: 'Bob Hijack' });
    expect(res.status).toBe(404);

    const rows: Array<{ name: string }> = await dataSource.query(
      'SELECT name FROM subscribers WHERE id = $1',
      [subId],
    );
    expect(rows[0].name).toBe('Alice Only');
  });

  // VAL-SUB-008
  it('DELETE removes subscriber and its M2M rows; list no longer includes it', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Delete Me',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms', 'wildfires'],
    });
    const subId = asSub(created).id;

    const del = await context.http
      .delete(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader);
    expect([204, 200]).toContain(del.status);

    const subRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscribers WHERE id = $1',
      [subId],
    );
    expect(Number(subRows[0].count)).toBe(0);
    const joinRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(Number(joinRows[0].count)).toBe(0);

    const list = await context.http
      .get('/api/subscribers')
      .set('Authorization', alice.authHeader);
    expect(list.status).toBe(200);
    expect(asSubList(list).map((s) => s.id)).not.toContain(subId);
  });

  // VAL-SUB-009
  it('DELETE on another user subscriber returns 404; Alice row still present', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const bob = await registerAndLogin(context, 'bob@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Alice Keeps',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    const res = await context.http
      .delete(`/api/subscribers/${subId}`)
      .set('Authorization', bob.authHeader);
    expect(res.status).toBe(404);

    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscribers WHERE id = $1',
      [subId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  // VAL-SUB-010
  it('POST /:id/test-notification writes one log row with source=test, status=mocked; no real Discord POST', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Test Me',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    const res = await context.http
      .post(`/api/subscribers/${subId}/test-notification`)
      .set('Authorization', alice.authHeader);
    expect([200, 201]).toContain(res.status);
    const body = asTest(res);
    expect(typeof body.id).toBe('string');

    const logRows: Array<{
      source: string;
      status: string;
      reference_id: string;
      subscriber_id: string;
    }> = await dataSource.query(
      'SELECT source, status, reference_id, subscriber_id FROM notification_log WHERE id = $1',
      [body.id],
    );
    expect(logRows).toHaveLength(1);
    expect(logRows[0].source).toBe('test');
    expect(logRows[0].status).toBe('mocked');
    expect(logRows[0].subscriber_id).toBe(subId);

    // Exactly one log row total for this subscriber.
    const allRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM notification_log WHERE subscriber_id = $1',
      [subId],
    );
    expect(Number(allRows[0].count)).toBe(1);
  });

  // VAL-SUB-012
  it('PATCH with unknown category slug returns 400 naming the slug; no partial M2M writes', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Atomic',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    // Capture pre-state: 1 row for severeStorms.
    const beforeRows: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(beforeRows.map((r) => r.category_id)).toEqual(['severeStorms']);

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader)
      .send({ eonetCategorySlugs: ['severeStorms', 'doesNotExist'] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(asError(res).message)).toMatch(/doesNotExist/);

    // No new rows added; pre-existing row still present.
    const afterRows: Array<{ category_id: string }> = await dataSource.query(
      'SELECT category_id FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(afterRows.map((r) => r.category_id)).toEqual(['severeStorms']);
  });

  // VAL-SUB-013
  it('PATCH omitting eonetCategorySlugs leaves categories unchanged', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Keep Cats',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms', 'wildfires'],
    });
    const subId = asSub(created).id;

    const beforeRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    const beforeCount = Number(beforeRows[0].count);
    expect(beforeCount).toBe(2);

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(asSub(res).name).toBe('Renamed');
    expect(asSub(res).eonetCategorySlugs.sort()).toEqual([
      'severeStorms',
      'wildfires',
    ]);

    const afterRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(Number(afterRows[0].count)).toBe(beforeCount);
  });

  // VAL-SUB-013 companion: PATCH with eonetCategorySlugs: null → 400
  it('PATCH with eonetCategorySlugs: null returns 400; categories unchanged', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Null Test',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    const beforeRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    const beforeCount = Number(beforeRows[0].count);

    const res = await context.http
      .patch(`/api/subscribers/${subId}`)
      .set('Authorization', alice.authHeader)
      .send({ eonetCategorySlugs: null });
    expect(res.status).toBe(400);
    expect(JSON.stringify(asError(res).message)).toMatch(/eonetCategorySlugs/i);

    const afterRows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1',
      [subId],
    );
    expect(Number(afterRows[0].count)).toBe(beforeCount);
  });

  // VAL-SUB-014
  it('test-notification ignores enabled=false and still writes a log row', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Disabled',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      enabled: false,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;
    expect(asSub(created).enabled).toBe(false);

    const res = await context.http
      .post(`/api/subscribers/${subId}/test-notification`)
      .set('Authorization', alice.authHeader);
    expect([200, 201]).toContain(res.status);
    const logId = asTest(res).id;

    const subRow: Array<{ enabled: boolean }> = await dataSource.query(
      'SELECT enabled FROM subscribers WHERE id = $1',
      [subId],
    );
    expect(subRow[0].enabled).toBe(false);

    const logRow: Array<{ source: string; status: string }> =
      await dataSource.query(
        'SELECT source, status FROM notification_log WHERE id = $1',
        [logId],
      );
    expect(logRow).toHaveLength(1);
    expect(logRow[0].source).toBe('test');
    expect(['mocked', 'sent']).toContain(logRow[0].status);
  });

  // VAL-CROSS-011 companion: webhook URL never in list/test-notification responses
  it('never echoes the raw webhook URL in any list or test-notification response', async () => {
    const alice = await registerAndLogin(context, 'alice@example.com');
    const created = await createSubscriber(context, alice, {
      name: 'Privacy',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms'],
    });
    const subId = asSub(created).id;

    const list = await context.http
      .get('/api/subscribers')
      .set('Authorization', alice.authHeader);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/discordWebhookUrl/);
    expect(JSON.stringify(list.body)).not.toMatch(
      /discord\.com\/api\/webhooks\/1234567890\/abcdef123456/,
    );

    const test = await context.http
      .post(`/api/subscribers/${subId}/test-notification`)
      .set('Authorization', alice.authHeader);
    expect([200, 201]).toContain(test.status);
    expect(JSON.stringify(test.body)).not.toMatch(validWebhookUrl);

    // The notification_log payload must not contain the raw webhook URL.
    const logRow: Array<{ payload: string }> = await dataSource.query(
      'SELECT payload::text AS payload FROM notification_log WHERE subscriber_id = $1',
      [subId],
    );
    expect(logRow).toHaveLength(1);
    expect(logRow[0].payload).not.toMatch(
      /discord\.com\/api\/webhooks\/1234567890\/abcdef123456/,
    );
    expect(logRow[0].payload).toMatch(/\/webhooks\/\.\.\.\/3456/);
  });
});
