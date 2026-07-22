import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EonetEventDto, NasaClientService } from '../common';
import { EonetCategory } from './entities/eonet-category.entity';
import {
  EonetEvent,
  EonetStatus,
  EonetGeometryPoint,
} from './entities/eonet-event.entity';

/**
 * Number of days back to fetch closed events for. Bounded so the closed-fetch
 * is never unbounded (architecture §4 / VAL-EONET-009). Overridable via env.
 */
export const CLOSED_WINDOW_DAYS_DEFAULT = 30;

function closedWindowDays(): number {
  const fromEnv = Number(process.env.EONET_CLOSED_WINDOW_DAYS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return CLOSED_WINDOW_DAYS_DEFAULT;
}

/** Returns a `YYYY-MM-DD` for `daysBefore` days before `now`. */
function dateNDaysAgo(daysBefore: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - daysBefore * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Derives the EONET status from the raw `closed` field. */
function deriveStatus(closed: string | null | undefined): {
  status: EonetStatus;
  closedAt: Date | null;
} {
  if (closed === null || closed === undefined || closed === '') {
    return { status: 'open', closedAt: null };
  }
  const parsed = new Date(closed);
  return {
    status: 'closed',
    closedAt: Number.isNaN(parsed.getTime()) ? null : parsed,
  };
}

/**
 * Normalizes a raw EONET geometry value into a persistable form.
 *
 * - A JSON array (including `[]`) is preserved verbatim.
 * - `null` is preserved as `null` (no geometry; persisted, no fan-out).
 * - Any other non-array value (string, number, object) is malformed and signals
 *   the caller to skip the event entirely.
 *
 * Returns `{ kind: 'array', value } | { kind: 'null', value: null } |
 * { kind: 'malformed' }`.
 */
function normalizeGeometry(
  raw: unknown,
):
  | { kind: 'array'; value: EonetGeometryPoint[] }
  | { kind: 'null'; value: null }
  | { kind: 'malformed' } {
  if (raw === null || raw === undefined) {
    return { kind: 'null', value: null };
  }
  if (Array.isArray(raw)) {
    return { kind: 'array', value: raw as EonetGeometryPoint[] };
  }
  return { kind: 'malformed' };
}

/** Stable JSON serialization for geometry diffing. */
function geometrySignature(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'unstringable';
  }
}

/** Summary of a single {@link EonetService.fetchAndStore} run. */
export interface EonetFetchResult {
  /** Event ids newly inserted this run. */
  detected: string[];
  /** Event ids whose status or geometry changed this run. */
  updated: string[];
  /** Event ids skipped due to malformed geometry. */
  skipped: string[];
  /** Event ids seen but unchanged (last_seen_at refreshed only). */
  unchanged: string[];
}

/**
 * EONET ingestion service. Seeds categories, fetches open + bounded-closed
 * events, reconciles M2M links, lazily creates unknown categories, skips
 * malformed-geometry events, preserves large geometries verbatim, and keeps
 * `first_seen_at` stable while refreshing `last_seen_at` on every poll.
 *
 * Fan-out notifications are intentionally NOT triggered here; M3 wires
 * `NotificationService.fanOut` against the returned `detected`/`updated` lists
 * (with empty-geometry events excluded from fan-out per VAL-EONET-005).
 */
@Injectable()
export class EonetService {
  private readonly logger = new Logger(EonetService.name);

  constructor(
    @InjectRepository(EonetEvent)
    private readonly eventRepo: Repository<EonetEvent>,
    @InjectRepository(EonetCategory)
    private readonly categoryRepo: Repository<EonetCategory>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly nasaClient: NasaClientService,
  ) {}

  /** Returns all seeded categories as `{id, title, description}`. */
  async listCategories(): Promise<
    Array<{ id: string; title: string; description: string | null }>
  > {
    const rows = await this.categoryRepo.find({
      order: { id: 'ASC' },
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
    }));
  }

  /**
   * Fetches the EONET categories feed and reconciles `eonet_categories`.
   * Idempotent: re-seeding upserts by `id` and leaves the row count unchanged.
   * Returns the upserted category ids.
   */
  async seedCategories(): Promise<string[]> {
    const response = await this.nasaClient.getEonetCategories();
    const ids: string[] = [];
    for (const cat of response.categories ?? []) {
      if (!cat.id) {
        continue;
      }
      await this.categoryRepo.save({
        id: cat.id,
        title: cat.title,
        description: cat.description ?? null,
      });
      ids.push(cat.id);
    }
    this.logger.log(`Seeded ${ids.length} EONET categories.`);
    return ids;
  }

  /**
   * Full EONET ingestion tick. Seeds categories if the table is empty, then
   * fetches open + bounded-closed events, persists/updates each event, lazily
   * creates unknown categories, reconciles M2M links, and returns a diff
   * summary. Malformed-geometry events are skipped; other events persist
   * normally. The caller (trigger / scheduler) always observes a 2xx outcome
   * even when some events are skipped.
   */
  async fetchAndStore(): Promise<EonetFetchResult> {
    const categoryCount = await this.categoryRepo.count();
    if (categoryCount === 0) {
      this.logger.log('EONET categories empty; seeding before event fetch.');
      await this.seedCategories();
    }

    const openEvents = await this.fetchEvents({ status: 'open' });
    const start = dateNDaysAgo(closedWindowDays());
    const closedEvents = await this.fetchEvents({
      status: 'closed',
      start,
    });

    const result: EonetFetchResult = {
      detected: [],
      updated: [],
      skipped: [],
      unchanged: [],
    };

    const all = [...openEvents, ...closedEvents];
    for (const dto of all) {
      await this.persistEvent(dto, result);
    }

    this.logger.log(
      `EONET fetch complete: ${result.detected.length} detected, ` +
        `${result.updated.length} updated, ${result.unchanged.length} unchanged, ` +
        `${result.skipped.length} skipped.`,
    );
    return result;
  }

  /** Fetches the events list for a single status window, mapping errors to empty. */
  private async fetchEvents(query: {
    status: 'open' | 'closed';
    start?: string;
  }): Promise<EonetEventDto[]> {
    try {
      const response = await this.nasaClient.getEonetEvents(query);
      return response.events ?? [];
    } catch (err) {
      this.logger.warn(
        `EONET events fetch (status=${query.status}) failed: ` +
          `${(err as Error).message}; continuing with empty set.`,
      );
      return [];
    }
  }

  /**
   * Persists (or updates) a single EONET event and reconciles its M2M
   * categories. Skips malformed-geometry events. Lazily creates unknown
   * category slugs. Mutates `result` to record the outcome.
   */
  private async persistEvent(
    dto: EonetEventDto,
    result: EonetFetchResult,
  ): Promise<void> {
    const geom = normalizeGeometry(dto.geometry);
    if (geom.kind === 'malformed') {
      this.logger.warn(
        `EONET event ${dto.id} has malformed geometry (non-array); skipping.`,
      );
      result.skipped.push(dto.id);
      return;
    }

    const geometryValue = geom.kind === 'array' ? geom.value : null;
    const { status, closedAt } = deriveStatus(dto.closed);

    // Lazily create any unknown categories referenced by this event.
    const categories: EonetCategory[] = [];
    for (const ref of dto.categories ?? []) {
      if (!ref.id) {
        continue;
      }
      let cat = await this.categoryRepo.findOne({ where: { id: ref.id } });
      if (!cat) {
        this.logger.warn(
          `EONET category '${ref.id}' not seeded; lazily creating.`,
        );
        cat = await this.categoryRepo.save({
          id: ref.id,
          title: ref.title ?? ref.id,
          description: null,
        });
      }
      categories.push(cat);
    }

    const existing = await this.eventRepo.findOne({ where: { id: dto.id } });
    const now = new Date();

    if (!existing) {
      const event = this.eventRepo.create({
        id: dto.id,
        title: dto.title,
        description: dto.description ?? null,
        link: dto.link,
        status,
        closedAt,
        firstSeenAt: now,
        lastSeenAt: now,
        geometry: geometryValue,
      });
      await this.eventRepo.save(event);
      await this.syncCategories(dto.id, categories);
      this.logger.log(`EONET event detected: ${dto.id}.`);
      result.detected.push(dto.id);
      return;
    }

    // Existing event: detect status / geometry changes; preserve first_seen_at.
    const statusChanged = existing.status !== status;
    const geometryChanged =
      geometrySignature(existing.geometry) !== geometrySignature(geometryValue);

    existing.title = dto.title;
    existing.description = dto.description ?? null;
    existing.link = dto.link;
    existing.status = status;
    existing.closedAt = closedAt;
    existing.lastSeenAt = now;
    existing.geometry = geometryValue;
    await this.eventRepo.save(existing);
    await this.syncCategories(dto.id, categories);

    if (statusChanged) {
      this.logger.log(
        `EONET event updated: ${dto.id} (status ${existing.status}->${status}).`,
      );
      result.updated.push(dto.id);
    } else if (geometryChanged) {
      this.logger.log(`EONET event updated: ${dto.id} (geometry changed).`);
      result.updated.push(dto.id);
    } else {
      result.unchanged.push(dto.id);
    }
  }

  /**
   * Reconciles the `eonet_event_categories` junction for a single event by
   * deleting existing rows and inserting the current set. Idempotent across
   * repeat polls: the junction row set is stable when the payload is unchanged.
   */
  private async syncCategories(
    eventId: string,
    categories: EonetCategory[],
  ): Promise<void> {
    await this.dataSource.query(
      'DELETE FROM eonet_event_categories WHERE event_id = $1',
      [eventId],
    );
    if (categories.length === 0) {
      return;
    }
    const values = categories.map((_, i) => `($1, $${i + 2})`).join(', ');
    const params = [eventId, ...categories.map((c) => c.id)];
    await this.dataSource.query(
      `INSERT INTO eonet_event_categories (event_id, category_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      params,
    );
  }

  /**
   * Paginated EONET events query with optional `category` (slug) and `status`
   * (`open`|`closed`) filters applied as an intersection. Ordered by
   * `last_seen_at DESC`. Returns `{data, total, page, limit}`.
   */
  async listEvents(options: {
    category?: string;
    status?: 'open' | 'closed';
    page: number;
    limit: number;
  }): Promise<{
    data: EonetEvent[];
    total: number;
    page: number;
    limit: number;
  }> {
    const qb = this.eventRepo
      .createQueryBuilder('e')
      .orderBy('e.lastSeenAt', 'DESC')
      .skip((options.page - 1) * options.limit)
      .take(options.limit);

    if (options.status) {
      qb.andWhere('e.status = :status', { status: options.status });
    }

    if (options.category) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM eonet_event_categories ec WHERE ec.event_id = e.id AND ec.category_id = :category)`,
        { category: options.category },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: options.page, limit: options.limit };
  }
}
