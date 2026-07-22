import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EonetService } from './eonet.service';

/**
 * Exponential backoff schedule between EONET retry attempts (architecture §12).
 * Default cadence mirrors APOD: 1 s / 3 s / 9 s. Overridable via DI for tests.
 */
export const EONET_BACKOFF_MS = 'EONET_BACKOFF_MS';
export const DEFAULT_EONET_BACKOFF_MS = [1_000, 3_000, 9_000];

/** Maximum number of attempts per EONET scheduler tick. */
export const EONET_MAX_ATTEMPTS = 3;

export interface EonetAttemptLogEntry {
  attempt: number;
  at: Date;
  delayBeforeMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function pollMinutes(): number {
  const fromEnv = Number(process.env.EONET_POLL_MINUTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return 15;
}

/**
 * EONET scheduler. Polls the EONET API on a configurable interval (default
 * 15 min via `EONET_POLL_MINUTES`) and ingests events with retry/backoff.
 *
 * Concurrency: an in-process `running` flag enforces skip-if-running so a tick
 * fired while the previous one is still in flight is skipped and logged
 * (architecture §12 / VAL-SCHED-010). The flag is also used by the overlap
 * spec in `m2-scheduler-resilience-and-health`.
 *
 * The on-boot catch-up is gated by `EONET_BOOT_CATCHUP=false` (set globally in
 * `test/setup/env.ts`) so the integration test app does not fire live NASA on
 * boot. The scheduler spec exercises `runTick()` directly.
 */
@Injectable()
export class EonetScheduler implements OnModuleInit {
  private readonly logger = new Logger(EonetScheduler.name);
  /** Visible for tests: chronological log of retry attempts within the latest run. */
  readonly attemptLog: EonetAttemptLogEntry[] = [];
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly eonetService: EonetService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(EONET_BACKOFF_MS) private readonly backoff: number[],
  ) {}

  onModuleInit(): void {
    if (process.env.EONET_BOOT_CATCHUP === 'false') {
      this.logger.log(
        'EONET boot catch-up disabled by EONET_BOOT_CATCHUP=false.',
      );
    } else {
      // Best-effort on-boot poll; failures are logged and never crash boot.
      void this.runTick().catch((err) =>
        this.logger.error(
          `EONET boot catch-up crashed: ${(err as Error).message}`,
        ),
      );
    }

    const minutes = pollMinutes();
    const ms = minutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      void this.runTick().catch((err) =>
        this.logger.error(
          `EONET interval tick crashed: ${(err as Error).message}`,
        ),
      );
    }, ms);
    // Register with the nest schedule registry for introspection / cleanup.
    try {
      this.schedulerRegistry.addInterval('eonet-poll', this.intervalId);
    } catch {
      // Registry may reject duplicates in test harnesses; non-fatal.
    }
    this.logger.log(`EONET scheduler armed: polling every ${minutes} min.`);
  }

  /** True when a tick is currently in flight (visible for overlap tests). */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * A single EONET poll with skip-if-running + retry/backoff. Swallows all
   * failures so the scheduler never crashes and stays armed for the next tick.
   */
  async runTick(): Promise<void> {
    if (this.running) {
      this.logger.warn('EONET tick: previous tick still running, skipping.');
      return;
    }
    this.running = true;
    try {
      await this.runWithRetry(() => this.eonetService.fetchAndStore());
    } catch (err) {
      this.logger.error(`EONET tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs `fn` with up to {@link EONET_MAX_ATTEMPTS} attempts. Between failed
   * attempts it sleeps `backoff[attempt-1]`. On final failure the error is
   * logged and swallowed so the caller never crashes. Records each attempt in
   * {@link attemptLog}.
   */
  async runWithRetry<T>(fn: () => Promise<T>): Promise<T | undefined> {
    this.attemptLog.length = 0;
    for (let attempt = 1; attempt <= EONET_MAX_ATTEMPTS; attempt += 1) {
      const delayBeforeMs = attempt > 1 ? this.delayFor(attempt) : 0;
      if (delayBeforeMs > 0) {
        await sleep(delayBeforeMs);
      }
      this.attemptLog.push({ attempt, at: new Date(), delayBeforeMs });
      try {
        this.logger.log(
          `EONET fetch attempt ${attempt}/${EONET_MAX_ATTEMPTS}.`,
        );
        const result = await fn();
        this.logger.log(`EONET fetch succeeded on attempt ${attempt}.`);
        return result;
      } catch (err) {
        const message = (err as Error).message;
        if (attempt < EONET_MAX_ATTEMPTS) {
          this.logger.warn(
            `EONET fetch attempt ${attempt} failed: ${message}; retrying.`,
          );
        } else {
          this.logger.error(
            `EONET fetch failed after ${EONET_MAX_ATTEMPTS} attempts: ${message}`,
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
