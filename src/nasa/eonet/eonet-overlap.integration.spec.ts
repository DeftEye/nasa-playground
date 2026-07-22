import nock from 'nock';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../../test/utils';
import { EonetScheduler } from './eonet.scheduler';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';

/**
 * Integration spec for VAL-SCHED-010: while one EONET tick is in flight
 * (NASA response delayed), the next interval tick is skipped with a clear log
 * line and no duplicate `eonet_event_categories` rows appear for the same
 * event across the overlapping window.
 *
 * Uses the real test DB so the M2M junction is exercised end-to-end.
 */
describe('EONET scheduler overlap (integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;
  let scheduler: EonetScheduler;
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    scheduler = context.app.get(EonetScheduler);
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

  const countEvents = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_events',
    );
    return Number(rows[0].count);
  };

  const countLinksFor = async (eventId: string): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM eonet_event_categories WHERE event_id = $1',
      [eventId],
    );
    return Number(rows[0].count);
  };

  // VAL-SCHED-010
  it('skips a tick fired while the previous one is still running and writes no duplicate M2M rows', async () => {
    const eventId = 'EONET_OVERLAP_1';

    // Seed categories first so the tick only needs the events fetch (which we
    // delay). This makes the overlap window deterministic.
    await dataSource.query(
      `INSERT INTO eonet_categories (id, title, description) VALUES ('severeStorms', 'Severe Storms', NULL)`,
    );

    // Nock the events fetch with a delay so the first tick is still in flight
    // when we fire the second. Categories table is non-empty -> no categories
    // fetch is issued by the service.
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'open')
      .delay(300)
      .reply(
        200,
        {
          events: [
            {
              id: eventId,
              title: 'Overlap Storm',
              description: null,
              link: `https://eonet.gsfc.nasa.gov/api/v3/events/${eventId}`,
              closed: null,
              categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
              geometry: [{ type: 'Point', coordinates: [-86, 28.5] }],
            },
          ],
        },
        { 'content-type': 'application/json' },
      );
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'closed')
      .reply(200, { events: [] }, { 'content-type': 'application/json' });

    // Spy on the scheduler's logger to capture the skip log line.
    const logger = (
      scheduler as unknown as {
        logger: Logger;
      }
    ).logger;
    const warnSpy = jest
      .spyOn(logger, 'warn')
      .mockImplementation(() => undefined);

    try {
      // Fire the first tick (in flight for ~300ms due to the delay).
      const firstTick = scheduler.runTick();

      // Let the first tick set running=true.
      await new Promise((r) => setTimeout(r, 50));
      expect(scheduler.isRunning()).toBe(true);

      // Fire a second tick while the first is still running -> should skip.
      await scheduler.runTick();

      // The skip log line must have been emitted (architecture §12).
      const skipCalled = warnSpy.mock.calls.some((call) =>
        String(call[0]).includes('previous tick still running, skipping'),
      );
      expect(skipCalled).toBe(true);

      // Wait for the first tick to finish.
      await firstTick;
      expect(scheduler.isRunning()).toBe(false);

      // Exactly one event persisted, and exactly one M2M row for it (no
      // duplicates from the overlapping ticks).
      expect(await countEvents()).toBe(1);
      expect(await countLinksFor(eventId)).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
