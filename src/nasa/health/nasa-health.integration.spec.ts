import nock from 'nock';
import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../../test/utils';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';

interface HealthBody {
  status: 'ok' | 'down';
  db: 'up' | 'down';
  nasaReachable: boolean;
}

const asHealth = (res: Response): HealthBody => res.body as HealthBody;

/**
 * Integration specs for `GET /api/nasa/health` (VAL-CROSS-012).
 *
 * - DB reachable + NASA reachable → 200 `{status:'ok', db:'up', nasaReachable:true}`.
 * - DB reachable + NASA unreachable → 200 `{status:'ok', db:'up', nasaReachable:false}`.
 * - DB unreachable → 503 `{status:'down', db:'down', nasaReachable:false}`.
 */
describe('NASA health (integration)', () => {
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

  // VAL-CROSS-012 (DB up + NASA up -> 200, ok, up, true)
  it('returns 200 with db up and nasaReachable true when both are reachable', async () => {
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.api_key === 'test-key')
      .reply(
        200,
        {
          date: '2024-01-01',
          title: 'Probe',
          explanation: 'probe',
          url: 'https://example.com/x.jpg',
          media_type: 'image',
        },
        { 'content-type': 'application/json' },
      );

    const res = await context.http.get('/api/nasa/health');
    expect(res.status).toBe(200);
    const body = asHealth(res);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(body.nasaReachable).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  // VAL-CROSS-012 / VAL-SCHED-009 (DB up + NASA down -> still 200, nasaReachable false)
  it('returns 200 with db up and nasaReachable false when NASA nocks 503', async () => {
    const scope = nock(NASA_BASE).get(APOD_PATH).query(true).reply(503);

    const res = await context.http.get('/api/nasa/health');
    expect(res.status).toBe(200);
    const body = asHealth(res);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(body.nasaReachable).toBe(false);
    expect(scope.isDone()).toBe(true);
  });

  // VAL-CROSS-012 (DB down -> 503, db down, nasaReachable false)
  it('returns 503 with db down when the Postgres connection is broken', async () => {
    // Force the DataSource query to throw by destroying it; restore after.
    await dataSource.destroy();
    try {
      // NASA is nocked up to prove it is NOT consulted when DB is down.
      const scope = nock(NASA_BASE).get(APOD_PATH).query(true).reply(200, {
        date: '2024-01-01',
        title: 'Probe',
        explanation: 'probe',
        url: 'https://example.com/x.jpg',
        media_type: 'image',
      });

      const res = await context.http.get('/api/nasa/health');
      expect(res.status).toBe(503);
      const body = asHealth(res);
      expect(body.status).toBe('down');
      expect(body.db).toBe('down');
      expect(body.nasaReachable).toBe(false);
      // NASA must not be probed when DB is down.
      expect(scope.isDone()).toBe(false);
    } finally {
      // Reconnect so afterEach resetDb and afterAll closeTestApp don't blow up.
      await dataSource.setOptions({}).initialize();
    }
  });
});
