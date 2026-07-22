import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import nock from 'nock';
import { Server } from 'node:http';
import { Repository } from 'typeorm';
import {
  ApodScheduler,
  APOD_BACKOFF_MS,
  DEFAULT_APOD_BACKOFF_MS,
} from './apod.scheduler';
import { ApodService, todayUtc } from './apod.service';
import { ApodEntry } from './entities/apod-entry.entity';
import {
  NasaClientService,
  NasaApodResponse,
  NasaApiUnavailableError,
} from '../common';

const NASA_BASE = 'https://api.nasa.gov';
const APOD_PATH = '/planetary/apod';
const FAST_BACKOFF = [10, 30, 90];

/**
 * Starts a local HTTP server that accepts connections but never responds,
 * letting the caller exercise a real socket inactivity timeout. Returns the
 * base URL (`http://localhost:<port>`) and a close function.
 */
async function startSilentServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = new Server((_req, res) => {
    // Intentionally never call res.end(); the client must time out.
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

/**
 * Builds a scheduler backed by a real ApodService + NasaClientService but with
 * an in-memory ApodEntry repository (TypeORM FakeRepository) so the scheduler
 * spec does not require Postgres. NASA HTTP is nocked per test.
 */
function fakeRepo(): Repository<ApodEntry> & {
  store: Map<string, ApodEntry>;
} {
  const store = new Map<string, ApodEntry>();
  const repo = {
    store,
    findOne: ({ where }: { where: { date?: string } }) =>
      where.date ? (store.get(where.date) ?? null) : null,
    count: () => store.size,
    save: (entry: ApodEntry | ApodEntry[]) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const e of entries) {
        store.set(e.date, { ...e });
      }
      return Array.isArray(entry) ? entries : entries[0];
    },
    createQueryBuilder: () => {
      throw new Error('not used in scheduler spec');
    },
  } as unknown as Repository<ApodEntry> & { store: Map<string, ApodEntry> };
  return repo;
}

async function buildScheduler(repo: ReturnType<typeof fakeRepo>): Promise<{
  scheduler: ApodScheduler;
  moduleRef: TestingModule;
}> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      NasaClientService,
      ApodService,
      ApodScheduler,
      { provide: getRepositoryToken(ApodEntry), useValue: repo },
      { provide: APOD_BACKOFF_MS, useValue: FAST_BACKOFF },
    ],
  }).compile();

  const scheduler = moduleRef.get(ApodScheduler);
  return { scheduler, moduleRef };
}

describe('ApodScheduler', () => {
  let moduleRefs: TestingModule[] = [];
  let savedApiKey: string | undefined;
  let savedBootFlag: string | undefined;
  let savedTimeout: string | undefined;

  beforeAll(() => {
    savedApiKey = process.env.NASA_API_KEY;
    savedBootFlag = process.env.APOD_BOOT_CATCHUP;
    savedTimeout = process.env.APOD_TIMEOUT_MS;
    process.env.NASA_API_KEY = 'test-key';
  });

  afterAll(async () => {
    process.env.NASA_API_KEY = savedApiKey;
    process.env.APOD_BOOT_CATCHUP = savedBootFlag;
    process.env.APOD_TIMEOUT_MS = savedTimeout;
    await Promise.all(moduleRefs.map((m) => m.close()));
    moduleRefs = [];
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // VAL-SCHED-005
  it('retries 3x with exponential backoff: 503 twice then 200 -> 3 attempts, row persisted', async () => {
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    const today = todayUtc();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(503)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(503)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    const start = Date.now();
    await scheduler.handleCron();
    const elapsed = Date.now() - start;

    expect(repo.store.size).toBe(1);
    expect(repo.store.get(today)?.title).toBe('Mock APOD');
    expect(scheduler.attemptLog).toHaveLength(3);
    // Backoff cadence: attempt2 after 10ms, attempt3 after 30ms -> total ~40ms.
    expect(elapsed).toBeGreaterThanOrEqual(
      FAST_BACKOFF[0] + FAST_BACKOFF[1] - 20,
    );
    // delayBeforeMs recorded: attempt1=0, attempt2=10, attempt3=30
    expect(scheduler.attemptLog.map((a) => a.delayBeforeMs)).toEqual([
      0,
      FAST_BACKOFF[0],
      FAST_BACKOFF[1],
    ]);
  });

  // VAL-SCHED-005 (exhaustion)
  it('after 3 failed attempts logs failure, persists nothing, and does not throw', async () => {
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    const today = todayUtc();
    nock(NASA_BASE).persist().get(APOD_PATH).query(true).reply(503);

    await expect(scheduler.handleCron()).resolves.toBeUndefined();
    expect(repo.store.size).toBe(0);
    expect(scheduler.attemptLog).toHaveLength(3);

    // Subsequent tick still works (scheduler stays armed) once NASA recovers.
    nock.cleanAll();
    nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });
    await scheduler.handleCron();
    expect(repo.store.size).toBe(1);
  });

  // VAL-SCHED-003 (on-boot catch-up)
  it('boot catch-up backfills 30 days when DB is empty', async () => {
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    const today = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today.getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      nock(NASA_BASE)
        .get(APOD_PATH)
        .query((q) => q.date === d)
        .reply(200, apodMock({ date: d, title: `BF ${d}` }), {
          'content-type': 'application/json',
        });
    }

    await scheduler.bootCatchUp();
    expect(repo.store.size).toBe(30);
    expect(scheduler.attemptLog.length).toBeGreaterThanOrEqual(1);
  });

  // VAL-SCHED-003 (boot with today present -> no fetch)
  it('boot catch-up fetches today only when present rows exist but today is missing', async () => {
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    // Seed a past row so count > 0 but today missing.
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    repo.store.set(yesterday, {
      date: yesterday,
      title: 'past',
      explanation: '',
      url: '',
      mediaType: 'image',
      videoUrl: null,
      copyright: null,
      fetchedAt: new Date(),
    });

    const today = todayUtc();
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    await scheduler.bootCatchUp();
    expect(repo.store.size).toBe(2);
    expect(repo.store.has(today)).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('boot catch-up skips fetch when today already present', async () => {
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    const today = todayUtc();
    repo.store.set(today, {
      date: today,
      title: 'today',
      explanation: '',
      url: '',
      mediaType: 'image',
      videoUrl: null,
      copyright: null,
      fetchedAt: new Date(),
    });

    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query(true)
      .reply(200, apodMock({ date: today }));

    await scheduler.bootCatchUp();
    expect(scope.isDone()).toBe(false);
    expect(repo.store.size).toBe(1);
  });

  // VAL-APOD-009 (timeout path; scheduler does not crash)
  it('NASA timeout triggers the timeout path, scheduler does not crash, next tick recovers', async () => {
    process.env.APOD_TIMEOUT_MS = '150';
    const server = await startSilentServer();
    process.env.APOD_BASE_URL = `${server.baseUrl}/planetary/apod`;
    try {
      const repo = fakeRepo();
      const { scheduler, moduleRef } = await buildScheduler(repo);
      moduleRefs.push(moduleRef);

      // First tick: the silent server never responds -> every attempt times out.
      await expect(scheduler.handleCron()).resolves.toBeUndefined();
      expect(repo.store.size).toBe(0); // nothing persisted on timeout
      expect(scheduler.attemptLog).toHaveLength(3);

      // Second tick: point back to NASA (mocked) -> recovers, scheduler armed.
      delete process.env.APOD_BASE_URL;
      const today = todayUtc();
      nock(NASA_BASE)
        .get(APOD_PATH)
        .query((q) => q.date === today)
        .reply(200, apodMock({ date: today }), {
          'content-type': 'application/json',
        });
      await scheduler.handleCron();
      expect(repo.store.size).toBe(1);
    } finally {
      delete process.env.APOD_TIMEOUT_MS;
      delete process.env.APOD_BASE_URL;
      await server.close();
    }
  });

  // VAL-SCHED-004 (DEMO_KEY fallback in scheduler path)
  it('uses api_key=DEMO_KEY in scheduler fetch when NASA_API_KEY is unset', async () => {
    delete process.env.NASA_API_KEY;
    const repo = fakeRepo();
    const { scheduler, moduleRef } = await buildScheduler(repo);
    moduleRefs.push(moduleRef);

    const today = todayUtc();
    const scope = nock(NASA_BASE)
      .get(APOD_PATH)
      .query((q) => q.api_key === 'DEMO_KEY' && q.date === today)
      .reply(200, apodMock({ date: today }), {
        'content-type': 'application/json',
      });

    await scheduler.handleCron();
    expect(scope.isDone()).toBe(true);
    expect(repo.store.size).toBe(1);
  });

  it('default backoff schedule is 1s/3s/9s (architecture §12)', () => {
    expect(DEFAULT_APOD_BACKOFF_MS).toEqual([1_000, 3_000, 9_000]);
  });

  // NasaClientService unit: timeout error type
  it('NasaClientService rejects with NasaApiUnavailableError on timeout', async () => {
    process.env.APOD_TIMEOUT_MS = '120';
    const server = await startSilentServer();
    process.env.APOD_BASE_URL = `${server.baseUrl}/planetary/apod`;
    const client = new NasaClientService();
    try {
      await expect(client.getApod('2024-01-01')).rejects.toThrow(
        NasaApiUnavailableError,
      );
    } finally {
      delete process.env.APOD_TIMEOUT_MS;
      delete process.env.APOD_BASE_URL;
      await server.close();
    }
  });
});
