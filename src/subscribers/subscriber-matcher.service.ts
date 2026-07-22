import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscriber } from './entities/subscriber.entity';

/**
 * Read-only subscriber selection for notification fan-out.
 *
 * Fan-out is **global**: APOD/EONET notifications are delivered to every
 * opted-in subscriber regardless of which user owns them. This service
 * centralizes the two selection rules so {@link ApodService} /
 * {@link EonetService} stay focused on ingestion:
 *
 * - **APOD**: every subscriber with `enabled=true` AND `apodEnabled=true`.
 * - **EONET**: every subscriber with `enabled=true` whose category selection
 *   either is empty (means "all EONET events") OR intersects the event's
 *   categories. Each subscriber is returned **at most once** per call so the
 *   per-subscriber cardinality invariant holds (VAL-NOTIF-006: an
 *   all-category subscriber receives exactly 1 row per event even when the
 *   event has multiple categories).
 *
 * The returned {@link Subscriber} entities carry `discordWebhookUrl` and their
 * loaded `categories` M2M so the caller can build the transport payload without
 * a second round-trip.
 */
@Injectable()
export class SubscriberMatcherService {
  private readonly logger = new Logger(SubscriberMatcherService.name);

  constructor(
    @InjectRepository(Subscriber)
    private readonly subscribers: Repository<Subscriber>,
  ) {}

  /**
   * Returns every enabled, APOD-enabled subscriber (across all users) with
   * categories loaded. Used by the APOD trigger / cron after a successful
   * fetch-and-store (VAL-SCHED-006).
   */
  async findApodEnabled(): Promise<Subscriber[]> {
    return this.subscribers.find({
      where: { enabled: true, apodEnabled: true },
      relations: { categories: true },
    });
  }

  /**
   * Returns every enabled subscriber (across all users) that should receive a
   * notification for an EONET event tagged with `categoryIds`:
   *
   * - subscribers with **no** category selection (empty M2M) → receive all
   *   events (exactly once, not once per matching category).
   * - subscribers with **any** selected category present in `categoryIds` →
   *   receive the event (once).
   * - subscribers whose selection does **not** intersect `categoryIds` →
   *   excluded.
   *
   * De-duplicates by subscriber id so a multi-category event never produces
   * more than one row for the same subscriber (VAL-NOTIF-006).
   */
  async findMatchingEonet(categoryIds: string[]): Promise<Subscriber[]> {
    const enabled = await this.subscribers.find({
      where: { enabled: true },
      relations: { categories: true },
    });
    const idSet = new Set(categoryIds);
    const seen = new Set<string>();
    const matches: Subscriber[] = [];
    for (const sub of enabled) {
      if (seen.has(sub.id)) {
        continue;
      }
      const cats = sub.categories ?? [];
      const matchesAny = cats.length === 0 || cats.some((c) => idSet.has(c.id));
      if (matchesAny) {
        seen.add(sub.id);
        matches.push(sub);
      }
    }
    return matches;
  }
}
