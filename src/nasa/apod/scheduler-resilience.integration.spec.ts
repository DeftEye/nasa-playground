import nock from 'nock';
import { DataSource } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { resetDb } from '../../../test/utils';
import { ApodScheduler, APOD_BACKOFF_MS } from './apod.scheduler';
import { todayUtc } from './apod.service';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const FAST_BACKOFF = [10, 30, 90];

/**
 * Waits for `predicate` to return true, polling every `intervalMs` up to
 * `timeoutMs`. Resolves once true; rejects on timeout.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Integration spec for VAL-SCHED-009: boot with an empty DB AND NASA nocked to
 * 503 → the app still boots, the on-boot catch-up logs 3 retry attempts, no
 * `apod_entries` row is inserted, `GET /api/nasa/health` returns 200 with
 * `db: 'up'`, and the next cron tick retries successfully once NASA recovers.
 *
 * This spec boots its own Nest application (separate from the shared
 * `createTestApp`) so it can enable `APOD_BOOT_CATCHUP` and override the retry
 * backoff to fast values for a deterministic, sub-second boot catch-up.
 */
describe('Scheduler resilience — boot with NASA down (integration)', () => {
  let app: INestApplication | undefined;
  let dataSource: DataSource | undefined;
  let scheduler: ApodScheduler | undefined;
  let http: ReturnType<typeof request> | undefined;
  let savedBootFlag: string | undefined;
  let savedApiKey: string | undefined;

  beforeAll(() => {
    savedBootFlag = process.env.APOD_BOOT_CATCHUP;
    savedApiKey = process.env.NASA_API_KEY;
  });

  afterEach(async () => {
    nock.cleanAll();
    if (dataSource && dataSource.isInitialized) {
      await resetDb(dataSource);
    }
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  afterAll(() => {
    process.env.APOD_BOOT_CATCHUP = savedBootFlag;
    process.env.NASA_API_KEY = savedApiKey;
  });

  // VAL-SCHED-009
  it('boots with empty DB + NASA 503: 3 retries logged, no row, health 200 db:up, next tick recovers', async () => {
    process.env.APOD_BOOT_CATCHUP = 'true';
    process.env.NASA_API_KEY = 'test-key';

    // NASA APOD is down for the entire boot catch-up window.
    nock(NASA_BASE).persist().get(APOD_PATH).query(true).reply(503);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APOD_BACKOFF_MS)
      .useValue(FAST_BACKOFF)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    scheduler = app.get(ApodScheduler);
    http = request(app.getHttpServer() as Server);

    // The boot catch-up is fire-and-forget in onModuleInit; wait for the 3
    // retry attempts to be recorded (final failure is logged + swallowed).
    await waitFor(() => scheduler!.attemptLog.length >= 3, 5_000, 10);
    expect(scheduler!.attemptLog).toHaveLength(3);
    // delayBeforeMs cadence: attempt1=0, attempt2=FAST_BACKOFF[0], attempt3=FAST_BACKOFF[1]
    expect(scheduler!.attemptLog.map((a) => a.delayBeforeMs)).toEqual([
      0,
      FAST_BACKOFF[0],
      FAST_BACKOFF[1],
    ]);

    // No row inserted during the failed boot catch-up.
    const rows: Array<{ count: string }> = await dataSource!.query(
      'SELECT COUNT(*)::text AS count FROM apod_entries',
    );
    expect(Number(rows[0].count)).toBe(0);

    // App still boots: health endpoint returns 200 with db up. NASA is still
    // nocked to 503 so nasaReachable is false, but DB-up keeps it 200.
    const health = await http.get('/api/nasa/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      status: 'ok',
      db: 'up',
      nasaReachable: false,
    });

    // Next cron tick retries once NASA recovers: re-nock to 200 for today.
    nock.cleanAll();
    const today = todayUtc();
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.api_key === 'test-key' && q.date === today)
      .reply(
        200,
        {
          date: today,
          title: 'Recovered',
          explanation: 'after downtime',
          url: 'https://example.com/recovered.jpg',
          media_type: 'image',
        },
        { 'content-type': 'application/json' },
      );

    await scheduler!.handleCron();
    expect(scope.isDone()).toBe(true);
    const rowsAfter: Array<{ count: string }> = await dataSource!.query(
      'SELECT COUNT(*)::text AS count FROM apod_entries',
    );
    expect(Number(rowsAfter[0].count)).toBe(1);
  }, 15_000);
});
