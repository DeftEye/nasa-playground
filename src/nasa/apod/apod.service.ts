import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApodEntry, ApodMediaType } from './entities/apod-entry.entity';
import { NasaApodResponse, NasaClientService } from '../common';

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
 * For a video APOD whose `url` is a YouTube link, returns the embed form
 * `https://www.youtube.com/embed/<id>`. For any non-YouTube host (Vimeo, etc.)
 * returns `null` so the frontend falls back to the raw `url`.
 */
export function toEmbedUrl(rawUrl: string): string | null {
  const id = extractYouTubeId(rawUrl);
  return id ? `https://www.youtube.com/embed/${id}` : null;
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

@Injectable()
export class ApodService {
  constructor(
    @InjectRepository(ApodEntry)
    private readonly repo: Repository<ApodEntry>,
    private readonly nasaClient: NasaClientService,
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
   * Backfills the last `days` consecutive dates ending today. Idempotent: a
   * re-run upserts each date (no new rows) and refreshes `fetchedAt`.
   */
  async backfill(days = 30): Promise<ApodEntry[]> {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      dates.push(dateNDaysAgo(i));
    }
    const entries: ApodEntry[] = [];
    for (const d of dates) {
      const response = await this.nasaClient.getApod(d);
      entries.push(this.transform(response, d));
    }
    return this.repo.save(entries);
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
