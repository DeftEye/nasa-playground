import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import nock from 'nock';
import { Server } from 'node:http';
import { DataSource, Repository } from 'typeorm';
import {
  EonetScheduler,
  EONET_BACKOFF_MS,
  DEFAULT_EONET_BACKOFF_MS,
} from './eonet.scheduler';
import { EonetService } from './eonet.service';
import { EonetCategory } from './entities/eonet-category.entity';
import { EonetEvent } from './entities/eonet-event.entity';
import {
  NasaClientService,
  NasaApiUnavailableError,
  EonetEventDto,
} from '../common';
import { NotificationService } from '../../notifications/notifications.service';
import { SubscriberMatcherService } from '../../subscribers/subscriber-matcher.service';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov';
const EONET_API = '/api/v3';
const FAST_BACKOFF = [10, 30, 90];

/** Starts a local HTTP server that accepts connections but never responds. */
async function startSilentServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = new Server((_req, res) => {
    void res;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to start silent server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { baseUrl, close };
}

/** Builds a minimal EONET event DTO; `over` always supplies `id`. */
function eventMock(
  over: Partial<EonetEventDto> & { id: string },
): EonetEventDto {
  return {
    title: 'Mock Event',
    description: null,
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_9999',
    closed: null,
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [{ type: 'Point', coordinates: [-86, 28.5] }],
    ...over,
  };
}

/** In-memory EonetService backed by Maps so the scheduler spec needs no DB. */
function buildInMemoryService(): {
  service: EonetService;
  events: Map<string, EonetEvent>;
  categories: Map<string, EonetCategory>;
} {
  const events = new Map<string, EonetEvent>();
  const categories = new Map<string, EonetCategory>();

  const eventRepo = {
    findOne: ({ where }: { where: { id: string } }) =>
      events.get(where.id) ?? null,
    count: () => events.size,
    save: (e: EonetEvent) => {
      events.set(e.id, { ...e });
      return e;
    },
    create: (e: Partial<EonetEvent>) => ({ ...e }) as EonetEvent,
    createQueryBuilder: () => {
      throw new Error('not used in scheduler spec');
    },
  } as unknown as Repository<EonetEvent>;

  const categoryRepo = {
    findOne: ({ where }: { where: { id: string } }) =>
      categories.get(where.id) ?? null,
    count: () => categories.size,
    save: (c: Partial<EonetCategory>) => {
      const full = { ...c } as EonetCategory;
      categories.set(full.id, full);
      return full;
    },
  } as unknown as Repository<EonetCategory>;

  // Junction writes are no-ops in memory; idempotency is verified via the
  // event/category Maps and the integration spec (real DB).
  const dataSource = {
    query: (): Promise<unknown> => Promise.resolve(undefined),
  } as unknown as DataSource;

  const nasaClient = new NasaClientService();
  // Fan-out deps are stubbed: the scheduler spec has no subscribers, so
  // fan-out is a no-op. Stubs prevent the constructor change from breaking
  // the in-memory harness.
  const notifications = {
    fanOut: jest.fn().mockResolvedValue([]),
  } as unknown as NotificationService;
  const subscriberMatcher = {
    findApodEnabled: jest.fn().mockResolvedValue([]),
    findMatchingEonet: jest.fn().mockResolvedValue([]),
  } as unknown as SubscriberMatcherService;
  const service = new EonetService(
    eventRepo,
    categoryRepo,
    dataSource,
    nasaClient,
    notifications,
    subscriberMatcher,
  );

  return { service, events, categories };
}

async function buildScheduler(
  service: EonetService,
  backoff: number[] = FAST_BACKOFF,
): Promise<{ scheduler: EonetScheduler; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      EonetScheduler,
      { provide: EonetService, useValue: service },
      { provide: SchedulerRegistry, useValue: new SchedulerRegistry() },
      { provide: EONET_BACKOFF_MS, useValue: backoff },
    ],
  }).compile();
  const scheduler = moduleRef.get(EonetScheduler);
  return { scheduler, moduleRef };
}

/** Nocks a full EONET fetch (categories + open + closed). */
function nockFull(opts: {
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

describe('EonetScheduler', () => {
  let moduleRefs: TestingModule[] = [];
  let savedApiKey: string | undefined;
  let savedBootFlag: string | undefined;
  let savedTimeout: string | undefined;

  beforeAll(() => {
    savedApiKey = process.env.NASA_API_KEY;
    savedBootFlag = process.env.EONET_BOOT_CATCHUP;
    savedTimeout = process.env.EONET_TIMEOUT_MS;
    process.env.NASA_API_KEY = 'test-key';
  });

  afterAll(async () => {
    process.env.NASA_API_KEY = savedApiKey;
    process.env.EONET_BOOT_CATCHUP = savedBootFlag;
    process.env.EONET_TIMEOUT_MS = savedTimeout;
    await Promise.all(moduleRefs.map((m) => m.close()));
    moduleRefs = [];
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // VAL-SCHED-002 (first tick seeds + fetches; no duplicates on subsequent)
  it('first tick seeds categories then fetches events; second tick adds no duplicates', async () => {
    const { service, events, categories } = buildInMemoryService();
    const { scheduler, moduleRef } = await buildScheduler(service);
    moduleRefs.push(moduleRef);

    nockFull({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_1' })],
    });
    await scheduler.runTick();
    expect(categories.size).toBe(1);
    expect(events.size).toBe(1);

    // Second tick: same payload, no categories fetch (already seeded).
    nockFull({
      open: [eventMock({ id: 'EONET_1' })],
    });
    await scheduler.runTick();
    expect(events.size).toBe(1); // no duplicate
    expect(categories.size).toBe(1);
    expect(scheduler.attemptLog).toHaveLength(1); // succeeded first try
  });

  // VAL-EONET-007 (idempotency at scheduler level)
  it('repeat ticks with unchanged payload leave counts unchanged', async () => {
    const { service, events, categories } = buildInMemoryService();
    const { scheduler, moduleRef } = await buildScheduler(service);
    moduleRefs.push(moduleRef);

    nockFull({
      categories: [{ id: 'wildfires', title: 'Wildfires' }],
      open: [
        eventMock({
          id: 'EONET_2',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
        }),
      ],
    });
    await scheduler.runTick();
    const afterFirstEvents = events.size;
    const afterFirstCats = categories.size;

    nockFull({
      open: [
        eventMock({
          id: 'EONET_2',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
        }),
      ],
    });
    await scheduler.runTick();
    expect(events.size).toBe(afterFirstEvents);
    expect(categories.size).toBe(afterFirstCats);
  });

  // VAL-EONET-008 (timeout path; scheduler survives + next tick recovers)
  it('EONET 30s timeout triggers the timeout path; scheduler does not crash; next tick recovers', async () => {
    process.env.EONET_TIMEOUT_MS = '150';
    const server = await startSilentServer();
    process.env.EONET_BASE_URL = `${server.baseUrl}/api/v3`;
    try {
      const { service, events } = buildInMemoryService();
      const { scheduler, moduleRef } = await buildScheduler(service);
      moduleRefs.push(moduleRef);

      // Every call times out -> 3 attempts, nothing persisted, no throw.
      await expect(scheduler.runTick()).resolves.toBeUndefined();
      expect(events.size).toBe(0);
      expect(scheduler.attemptLog).toHaveLength(3);

      // Next tick: point back to NASA (mocked) -> recovers.
      delete process.env.EONET_BASE_URL;
      nockFull({
        categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
        open: [eventMock({ id: 'EONET_3' })],
      });
      await scheduler.runTick();
      expect(events.size).toBe(1);
    } finally {
      delete process.env.EONET_TIMEOUT_MS;
      delete process.env.EONET_BASE_URL;
      await server.close();
    }
  });

  it('NasaClientService rejects with NasaApiUnavailableError on EONET timeout', async () => {
    process.env.EONET_TIMEOUT_MS = '120';
    const server = await startSilentServer();
    process.env.EONET_BASE_URL = `${server.baseUrl}/api/v3`;
    const client = new NasaClientService();
    try {
      await expect(client.getEonetCategories()).rejects.toThrow(
        NasaApiUnavailableError,
      );
    } finally {
      delete process.env.EONET_TIMEOUT_MS;
      delete process.env.EONET_BASE_URL;
      await server.close();
    }
  });

  // VAL-SCHED-005-equivalent (3x retry with backoff)
  it('retries 3x with exponential backoff: 503 twice then 200 -> 3 attempts, event persisted', async () => {
    const { service, events } = buildInMemoryService();
    const { scheduler, moduleRef } = await buildScheduler(service);
    moduleRefs.push(moduleRef);

    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(503)
      .get(`${EONET_API}/categories`)
      .reply(503)
      .get(`${EONET_API}/categories`)
      .reply(
        200,
        {
          categories: [
            { id: 'severeStorms', title: 'Severe Storms', description: null },
          ],
        },
        { 'content-type': 'application/json' },
      );
    nockFull({ open: [eventMock({ id: 'EONET_4' })] });

    const start = Date.now();
    await scheduler.runTick();
    const elapsed = Date.now() - start;

    expect(events.size).toBe(1);
    expect(scheduler.attemptLog).toHaveLength(3);
    expect(elapsed).toBeGreaterThanOrEqual(
      FAST_BACKOFF[0] + FAST_BACKOFF[1] - 20,
    );
    expect(scheduler.attemptLog.map((a) => a.delayBeforeMs)).toEqual([
      0,
      FAST_BACKOFF[0],
      FAST_BACKOFF[1],
    ]);
  });

  // VAL-SCHED-010 (skip-if-running)
  it('skips a tick fired while the previous one is still running', async () => {
    const { service, events } = buildInMemoryService();
    const { scheduler, moduleRef } = await buildScheduler(service);
    moduleRefs.push(moduleRef);

    // Delay the open events response so the first tick is still in flight.
    nockFull({
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      open: [eventMock({ id: 'EONET_5' })],
    });
    // Inject a delay into the events call by re-nocking with delay.
    nock.cleanAll();
    nock(EONET_BASE)
      .get(`${EONET_API}/categories`)
      .reply(
        200,
        {
          categories: [
            { id: 'severeStorms', title: 'Severe Storms', description: null },
          ],
        },
        { 'content-type': 'application/json' },
      );
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'open')
      .delay(200)
      .reply(
        200,
        { events: [eventMock({ id: 'EONET_5' })] },
        { 'content-type': 'application/json' },
      );
    nock(EONET_BASE)
      .get(`${EONET_API}/events`)
      .query((q) => q.status === 'closed')
      .reply(200, { events: [] }, { 'content-type': 'application/json' });

    const firstTick = scheduler.runTick();
    // While first tick is in flight, fire a second tick -> should skip.
    // Give the first tick a moment to set running=true.
    await new Promise((r) => setTimeout(r, 30));
    expect(scheduler.isRunning()).toBe(true);
    await scheduler.runTick(); // skipped

    await firstTick;
    expect(events.size).toBe(1); // only one event persisted, no duplicate
  });

  it('default backoff schedule is 1s/3s/9s (architecture §12)', () => {
    expect(DEFAULT_EONET_BACKOFF_MS).toEqual([1_000, 3_000, 9_000]);
  });
});
