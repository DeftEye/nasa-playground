import { DataSource } from 'typeorm';
import {
  closeTestApp,
  createTestApp,
  nockReset,
  resetDb,
  TestAppContext,
} from '../../test/utils';
import { User } from '../users/entities/user.entity';
import { Subscriber } from '../subscribers/entities/subscriber.entity';
import { NotificationLog } from '../notifications/entities/notification-log.entity';
import { EonetCategory } from '../nasa/eonet/entities/eonet-category.entity';

const MISSION_TABLES = [
  'users',
  'apod_entries',
  'eonet_categories',
  'eonet_events',
  'eonet_event_categories',
  'subscribers',
  'subscriber_categories',
  'notification_log',
];

interface ForeignKeyRow {
  delete_rule: string;
  child_table: string;
  child_column: string;
  parent_table: string;
}

describe('Domain entities and schema', () => {
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
    nockReset();
  });

  it('creates every mission table via synchronize', async () => {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tableNames = rows.map((row) => row.table_name);

    for (const table of MISSION_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  it('declares ON DELETE CASCADE foreign keys per architecture §5', async () => {
    const fks: ForeignKeyRow[] = await dataSource.query(`
      SELECT rc.delete_rule,
             kcu.table_name  AS child_table,
             kcu.column_name AS child_column,
             ccu.table_name  AS parent_table
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
       AND kcu.constraint_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.constraint_name
       AND ccu.constraint_schema = rc.constraint_schema
      WHERE rc.constraint_schema = 'public'
    `);

    const findFk = (child: string, column: string, parent: string) =>
      fks.find(
        (fk) =>
          fk.child_table === child &&
          fk.child_column === column &&
          fk.parent_table === parent,
      );

    const ownerFk = findFk('subscribers', 'owner_id', 'users');
    expect(ownerFk?.delete_rule).toBe('CASCADE');

    const notificationFk = findFk(
      'notification_log',
      'subscriber_id',
      'subscribers',
    );
    expect(notificationFk?.delete_rule).toBe('CASCADE');

    const subCategoryFk = findFk(
      'subscriber_categories',
      'subscriber_id',
      'subscribers',
    );
    expect(subCategoryFk?.delete_rule).toBe('CASCADE');
  });

  it('stores timestamp columns as timestamptz', async () => {
    const rows: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
    }> = await dataSource.query(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN (
            'created_at', 'fetched_at', 'first_seen_at', 'last_seen_at',
            'closed_at', 'delivered_at'
          )
      `);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_type).toBe('timestamp with time zone');
    }
  });

  it('cascades a user delete to subscribers, join rows, and notification log', async () => {
    const categoryRepo = dataSource.getRepository(EonetCategory);
    const userRepo = dataSource.getRepository(User);
    const subscriberRepo = dataSource.getRepository(Subscriber);
    const logRepo = dataSource.getRepository(NotificationLog);

    const category = await categoryRepo.save(
      categoryRepo.create({
        id: 'severeStorms',
        title: 'Severe Storms',
        description: null,
      }),
    );

    const user = await userRepo.save(
      userRepo.create({
        email: 'cascade@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      }),
    );

    const subscriber = await subscriberRepo.save(
      subscriberRepo.create({
        ownerId: user.id,
        name: 'Cascade Sub',
        discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
        enabled: true,
        apodEnabled: true,
        categories: [category],
      }),
    );

    await logRepo.save(
      logRepo.create({
        subscriberId: subscriber.id,
        source: 'test',
        referenceId: 'ref-1',
        payload: { content: 'hello' },
        status: 'mocked',
        error: null,
      }),
    );

    const joinBefore: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1`,
      [subscriber.id],
    );
    expect(joinBefore[0].count).toBe('1');

    await userRepo.delete({ id: user.id });

    expect(await subscriberRepo.count()).toBe(0);
    expect(await logRepo.count()).toBe(0);

    const joinAfter: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS count FROM subscriber_categories WHERE subscriber_id = $1`,
      [subscriber.id],
    );
    expect(joinAfter[0].count).toBe('0');

    expect(await categoryRepo.count()).toBe(1);
  });

  it('exposes working resetDb and nockReset helpers', async () => {
    const userRepo = dataSource.getRepository(User);
    await userRepo.save(
      userRepo.create({
        email: 'reset@example.com',
        passwordHash: 'hash',
      }),
    );
    expect(await userRepo.count()).toBe(1);

    await resetDb(dataSource);
    expect(await userRepo.count()).toBe(0);

    expect(() => nockReset()).not.toThrow();
  });
});
