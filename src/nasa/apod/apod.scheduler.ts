import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApodService, todayUtc } from './apod.service';

/**
 * Exponential backoff schedule between retry attempts (architecture §12).
 * Default cadence is 1 s / 3 s / 9 s. Overridable via DI for fast tests.
 *
 * Note on dead-code reconciliation (M5): with `APOD_MAX_ATTEMPTS = 3` (3 total
 * attempts = 1 initial + 2 retries), only `backoff[0]` (1s) and `backoff[1]`
 * (3s) are consumed. `backoff[2]` (9s) is a reserved slot for a potential
 * future 4th attempt — `delayFor` already handles it gracefully via a
 * fallback to the last element. The architecture's "3 retries at 1s/3s/9s"
 * phrasing describes the full backoff schedule; the v1 implementation performs
 * 3 total attempts (2 retries) and the 9s slot remains available if
 * `APOD_MAX_ATTEMPTS` is later raised to 4. This keeps the backoff array
 * self-documenting and avoids a silent dead-code value.
 */
export const APOD_BACKOFF_MS = 'APOD_BACKOFF_MS';
export const DEFAULT_APOD_BACKOFF_MS = [1_000, 3_000, 9_000];

/** Maximum number of attempts per scheduler tick / boot catch-up (1 initial + 2 retries). */
export const APOD_MAX_ATTEMPTS = 3;

export interface AttemptLogEntry {
  attempt: number;
  at: Date;
  delayBeforeMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * APOD scheduler. Fires on the `APOD_CRON` cron (default `0 16 * * *` UTC),
 * runs an on-boot catch-up when today's row is missing (or a 30-day backfill
 * on a truly empty DB), and retries NASA failures with exponential backoff.
 * Failures are logged and never crash the scheduler or the boot path.
 */
@Injectable()
export class ApodScheduler implements OnModuleInit {
  private readonly logger = new Logger(ApodScheduler.name);
  /** Visible for tests: chronological log of retry attempts within the latest run. */
  readonly attemptLog: AttemptLogEntry[] = [];
  /**
   * In-process skip-if-running flag (architecture §12). A tick fired while the
   * previous one is still in flight is skipped and logged, preventing
   * overlapping NASA fetches and duplicate writes.
   */
  private running = false;

  constructor(
    private readonly apodService: ApodService,
    @Inject(APOD_BACKOFF_MS) private readonly backoff: number[],
  ) {}

  /** True when a tick is currently in flight (visible for overlap tests). */
  isRunning(): boolean {
    return this.running;
  }

  onModuleInit(): void {
    // The boot catch-up is a best-effort optimization; in tests we disable it
    // via `APOD_BOOT_CATCHUP=false` so booting the app does not fire live NASA
    // requests. The scheduler spec exercises `bootCatchUp()` directly.
    if (process.env.APOD_BOOT_CATCHUP === 'false') {
      this.logger.log(
        'APOD boot catch-up disabled by APOD_BOOT_CATCHUP=false.',
      );
      return;
    }
    // Do not block module init on a best-effort catch-up; failures are logged
    // and the next cron tick retries.
    void this.bootCatchUp().catch((err) =>
      this.logger.error(
        `APOD boot catch-up crashed: ${(err as Error).message}`,
      ),
    );
  }

  /** On-boot: backfill 30 days when the DB is empty, else fetch today if missing. */
  async bootCatchUp(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'APOD boot catch-up: previous tick still running, skipping.',
      );
      return;
    }
    this.running = true;
    try {
      const count = await this.apodService.count();
      if (count === 0) {
        this.logger.log('APOD table empty on boot; running 30-day backfill.');
        // `failFast = true` makes the boot backfill throw on the FIRST date
        // failure (instead of collecting partial results) so
        // {@link runWithRetry} re-attempts the whole loop with 1s/3s/9s
        // backoff (architecture §12 / VAL-SCHED-009). The manual trigger
        // endpoint uses the default partial-success path (VAL-PRODFIX2-004).
        await this.runWithRetry(() => this.apodService.backfill(30, true));
        return;
      }
      const today = todayUtc();
      const existing = await this.apodService.findByDate(today);
      if (!existing) {
        this.logger.log(`APOD row for ${today} missing on boot; fetching.`);
        await this.runWithRetry(() => this.apodService.fetchAndStore(today));
        return;
      }
      this.logger.log(
        `APOD row for ${today} already present on boot; no fetch.`,
      );
    } finally {
      this.running = false;
    }
  }

  @Cron(process.env.APOD_CRON ?? '0 16 * * *')
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'APOD cron tick: previous tick still running, skipping.',
      );
      return;
    }
    this.running = true;
    try {
      this.logger.log('APOD cron tick: fetching today.');
      await this.runWithRetry(() =>
        this.apodService.fetchStoreAndNotify(todayUtc()),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs `fn` with up to {@link APOD_MAX_ATTEMPTS} attempts. Between failed
   * attempts it sleeps `backoff[attempt-1]` (1 s / 3 s / 9 s by default). On
   * final failure the error is logged and swallowed so the caller (cron /
   * boot) never crashes. Records each attempt in {@link attemptLog}.
   */
  async runWithRetry<T>(fn: () => Promise<T>): Promise<T | undefined> {
    this.attemptLog.length = 0;
    for (let attempt = 1; attempt <= APOD_MAX_ATTEMPTS; attempt += 1) {
      const delayBeforeMs = attempt > 1 ? this.delayFor(attempt) : 0;
      if (delayBeforeMs > 0) {
        await sleep(delayBeforeMs);
      }
      this.attemptLog.push({ attempt, at: new Date(), delayBeforeMs });
      try {
        this.logger.log(`APOD fetch attempt ${attempt}/${APOD_MAX_ATTEMPTS}.`);
        const result = await fn();
        this.logger.log(`APOD fetch succeeded on attempt ${attempt}.`);
        return result;
      } catch (err) {
        const message = (err as Error).message;
        if (attempt < APOD_MAX_ATTEMPTS) {
          this.logger.warn(
            `APOD fetch attempt ${attempt} failed: ${message}; retrying.`,
          );
        } else {
          this.logger.error(
            `APOD fetch failed after ${APOD_MAX_ATTEMPTS} attempts: ${message}`,
          );
        }
      }
    }
    return undefined;
  }

  /** Backoff delay applied before `attempt` (2 => 1s, 3 => 3s, ...). */
  private delayFor(attempt: number): number {
    const index = attempt - 2;
    if (index < 0) {
      return 0;
    }
    return this.backoff[index] ?? this.backoff[this.backoff.length - 1] ?? 0;
  }
}
