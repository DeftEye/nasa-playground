import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApodEntry, ApodMediaType } from './entities/apod-entry.entity';
import { NasaApodResponse, NasaClientService } from '../common';
import {
  NotificationService,
  FanOutPayload,
} from '../../notifications/notifications.service';
import { SubscriberMatcherService } from '../../subscribers/subscriber-matcher.service';

/**
 * Returns today's date as `YYYY-MM-DD` in UTC. NASA APOD dates are calendar
 * dates; using UTC keeps the scheduler and the `/today` endpoint consistent
 * across host timezones.
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Parses a URL and returns the YouTube video id when host is youtube/youtu.be, else null. */
function extractYouTubeId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isYouTube =
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be';
  if (!isYouTube) {
    return null;
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    return id.length > 0 ? id : null;
  }
  const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
  if (embedMatch) {
    return embedMatch[1];
  }
  const v = parsed.searchParams.get('v');
  if (v && v.length > 0) {
    return v;
  }
  return null;
}

/**
 * Parses a URL and returns the Vimeo video id when host is vimeo.com or
 * player.vimeo.com, else null. Accepts the canonical forms:
 * - `https://vimeo.com/<id>`
 * - `https://www.vimeo.com/<id>`
 * - `https://player.vimeo.com/video/<id>`
 * Trailing path segments (e.g. `/12345/abc` privacy hashes) are ignored; only
 * the first numeric segment is treated as the id.
 */
function extractVimeoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isVimeo =
    host === 'vimeo.com' ||
    host === 'www.vimeo.com' ||
    host === 'player.vimeo.com';
  if (!isVimeo) {
    return null;
  }
  if (host === 'player.vimeo.com') {
    const match = parsed.pathname.match(/^\/video\/([^/?#]+)/);
    return match ? match[1] : null;
  }
  // vimeo.com / www.vimeo.com -> first path segment is the numeric id.
  const segments = parsed.pathname.split('/').filter(Boolean);
  const id = segments[0];
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * For a video APOD whose `url` is a YouTube link, returns the embed form
 * `https://www.youtube.com/embed/<id>`. For a Vimeo link (`vimeo.com/<id>` or
 * `player.vimeo.com/video/<id>`) returns the embeddable player URL
 * `https://player.vimeo.com/video/<id>`. For any other host (direct `.mp4`,
 * unknown provider) returns `null` so the frontend falls back to a link to the
 * source `url`. The caller is responsible for preserving the original `url`
 * (this transform never blanks it).
 */
export function toEmbedUrl(rawUrl: string): string | null {
  const ytId = extractYouTubeId(rawUrl);
  if (ytId) {
    return `https://www.youtube.com/embed/${ytId}`;
  }
  const vimeoId = extractVimeoId(rawUrl);
  if (vimeoId) {
    return `https://player.vimeo.com/video/${vimeoId}`;
  }
  return null;
}

/** Maps NASA's free-form `media_type` string to our enum. */
function mapMediaType(raw: string): ApodMediaType {
  if (raw === 'image' || raw === 'video') {
    return raw;
  }
  return 'other';
}

/** Builds the `YYYY-MM-DD` for `daysBefore` days before `now` (inclusive of today). */
export function dateNDaysAgo(
  daysBefore: number,
  now: Date = new Date(),
): string {
  const d = new Date(now.getTime() - daysBefore * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** A single date that could not be fetched during a backfill run. */
export interface ApodBackfillFailure {
  /** The `YYYY-MM-DD` date that failed. */
  date: string;
  /** Human-readable reason (NASA error message, timeout, etc.). */
  reason: string;
}

/**
 * Partial-success summary returned by {@link ApodService.backfill}. Replaces
 * the previous bare `ApodEntry[]` so a single unavailable date no longer
 * aborts the whole loop or surfaces a 500 (VAL-PRODFIX2-004).
 */
export interface ApodBackfillResult {
  /** The number of consecutive days requested (1..30). */
  requestedDays: number;
  /** Entries that were fetched and persisted (upserted by date). */
  saved: ApodEntry[];
  /** Dates that could not be fetched, each with a reason. */
  failed: ApodBackfillFailure[];
}

@Injectable()
export class ApodService {
  private readonly logger = new Logger(ApodService.name);

  constructor(
    @InjectRepository(ApodEntry)
    private readonly repo: Repository<ApodEntry>,
    private readonly nasaClient: NasaClientService,
    private readonly notifications: NotificationService,
    private readonly subscriberMatcher: SubscriberMatcherService,
  ) {}

  findByDate(date: string): Promise<ApodEntry | null> {
    return this.repo.findOne({ where: { date } });
  }

  count(): Promise<number> {
    return this.repo.count();
  }

  /** Transforms a raw NASA APOD response into a persistable entity (no DB write). */
  transform(response: NasaApodResponse, date: string): ApodEntry {
    const mediaType = mapMediaType(response.media_type);
    const videoUrl = mediaType === 'video' ? toEmbedUrl(response.url) : null;
    return {
      date,
      title: response.title,
      explanation: response.explanation,
      url: response.url,
      mediaType,
      videoUrl,
      copyright: response.copyright ?? null,
      fetchedAt: new Date(),
    };
  }

  /**
   * Fetches a single APOD entry (default: today) from NASA and idempotently
   * upserts it by date. Returns the persisted row.
   */
  async fetchAndStore(date?: string): Promise<ApodEntry> {
    const targetDate = date ?? todayUtc();
    const response = await this.nasaClient.getApod(targetDate);
    const entry = this.transform(response, targetDate);
    return this.repo.save(entry);
  }

  /**
   * Builds the Discord webhook payload for an APOD entry (architecture §8 /
   * VAL-CROSS-004). Real-mode body shape: `{content, embeds:[{title, url,
   * image?:{url}}]}`. The `image` field is only included for `image` media
   * rows; video rows rely on Discord's YouTube auto-embed via `url` (the raw
   * YouTube watch link) so no `image` is sent.
   */
  buildApodPayload(entry: ApodEntry): FanOutPayload {
    const embed: Record<string, unknown> = {
      title: entry.title,
      url: entry.url,
    };
    if (entry.mediaType === 'image') {
      embed.image = { url: entry.url };
    }
    return {
      content: `New APOD: ${entry.title}`,
      embeds: [embed],
    };
  }

  /**
   * Fetches + upserts an APOD entry (default: today) then fans the
   * notification out to every enabled, APOD-enabled subscriber. Returns the
   * persisted APOD row. Fan-out failures are isolated inside
   * {@link NotificationService.fanOut} and never abort the caller
   * (VAL-NOTIF-008). Zero matching subscribers → zero log rows, trigger still
   * returns 2xx (VAL-NOTIF-012).
   *
   * Used by the manual trigger and the cron tick. Read paths (`getToday`,
   * `backfill`) deliberately use {@link fetchAndStore} directly so a
   * fetch-on-miss or boot backfill does not emit notifications.
   */
  async fetchStoreAndNotify(date?: string): Promise<ApodEntry> {
    const entry = await this.fetchAndStore(date);
    try {
      const subscribers = await this.subscriberMatcher.findApodEnabled();
      await this.notifications.fanOut(
        subscribers,
        this.buildApodPayload(entry),
        'apod',
        entry.date,
      );
    } catch (err) {
      // Fan-out selection must never crash the trigger / cron path.
      this.logger.error(
        `APOD fan-out failed for ${entry.date}: ${(err as Error).message}`,
      );
    }
    return entry;
  }

  /**
   * Backfills the last `days` consecutive dates ending today. Idempotent: a
   * re-run upserts each date (no new rows) and refreshes `fetchedAt`.
   *
   * Per-date fault-tolerant (VAL-PRODFIX2-004): each individual
   * `nasaClient.getApod(d)` + {@link transform} is wrapped in try/catch so a
   * single unavailable date (e.g. today's APOD not yet published -> NASA 404,
   * or a transient error) no longer aborts the whole loop or surfaces a raw
   * 500. Dates that succeed are persisted via `repo.save`; dates that fail are
   * reported in the `failed` array with a reason. Returns a partial-success
   * summary object instead of a bare `ApodEntry[]`.
   *
   * When `failFast` is `true`, the method rethrows on the FIRST per-date
   * failure (without persisting anything) so the caller (the on-boot
   * catch-up's `runWithRetry`) can re-attempt the whole loop with 1s/3s/9s
   * backoff per architecture §12 / VAL-SCHED-009. The manual trigger endpoint
   * uses the default (`failFast = false`) partial-success path.
   */
  async backfill(days = 30, failFast = false): Promise<ApodBackfillResult> {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      dates.push(dateNDaysAgo(i));
    }
    const saved: ApodEntry[] = [];
    const failed: ApodBackfillFailure[] = [];
    for (const d of dates) {
      try {
        const response = await this.nasaClient.getApod(d);
        saved.push(this.transform(response, d));
      } catch (err) {
        const reason = (err as Error).message || 'unknown error';
        this.logger.warn(
          `APOD backfill: failed to fetch ${d}: ${reason}; continuing.`,
        );
        failed.push({ date: d, reason });
        if (failFast) {
          // Rethrow so the boot catch-up's runWithRetry re-attempts the loop.
          throw err;
        }
      }
    }
    const persisted = saved.length > 0 ? await this.repo.save(saved) : saved;
    return { requestedDays: days, saved: persisted, failed };
  }

  /**
   * Returns today's APOD. If no row exists yet, fetches and persists it from
   * NASA (fetch-on-miss). Throws `NotFoundException` when a fetch is attempted
   * but NASA returns nothing usable.
   */
  async getToday(): Promise<ApodEntry> {
    const today = todayUtc();
    const existing = await this.findByDate(today);
    if (existing) {
      return existing;
    }
    const stored = await this.fetchAndStore(today);
    return stored;
  }

  /**
   * Paginated APOD archive query ordered by date DESC. Optional inclusive
   * `from`/`to` date range filter. Caller is responsible for validating params.
   */
  async listPaginated(options: {
    page: number;
    limit: number;
    from?: string;
    to?: string;
  }): Promise<{
    data: ApodEntry[];
    total: number;
    page: number;
    limit: number;
  }> {
    const qb = this.repo
      .createQueryBuilder('apod')
      .orderBy('apod.date', 'DESC')
      .skip((options.page - 1) * options.limit)
      .take(options.limit);

    if (options.from) {
      qb.andWhere('apod.date >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('apod.date <= :to', { to: options.to });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: options.page, limit: options.limit };
  }
}

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Validates that a value is a real `YYYY-MM-DD` calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_REGEX.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const composed = new Date(Date.UTC(year, month - 1, day));
  return (
    composed.getUTCFullYear() === year &&
    composed.getUTCMonth() === month - 1 &&
    composed.getUTCDate() === day
  );
}
