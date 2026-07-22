import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationLog,
  NotificationSource,
  NotificationStatus,
} from './entities/notification-log.entity';
import { Subscriber } from '../subscribers/entities/subscriber.entity';
import { maskWebhookUrl } from '../subscribers/webhook-redact';
import { DiscordTransportService } from './discord.transport';

/**
 * Payload shape fanned out to subscribers. The caller (APOD/EONET service)
 * supplies `content` + optional `embeds` (the Discord message body). The
 * service enriches each per-subscriber row with `subscriberId` and a redacted
 * `webhookUrl` before persisting so the raw webhook URL never lands in
 * `notification_log.payload` (VAL-NOTIF-007 / VAL-CROSS-011).
 */
export interface FanOutPayload {
  content: string;
  embeds?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Public representation of a `notification_log` row returned by
 * `GET /api/notifications`. `payload` is always included (with the redacted
 * webhook URL); `error` appears only on `failed` rows. The raw webhook URL is
 * never present (VAL-NOTIF-009 / VAL-NOTIF-007).
 */
export interface PublicNotification {
  id: string;
  deliveredAt: Date;
  source: NotificationSource;
  referenceId: string;
  subscriberId: string;
  status: NotificationStatus;
  payload: Record<string, unknown>;
  error: string | null;
}

/**
 * Notification fan-out + log query service.
 *
 * `fanOut` iterates subscribers, calls the Discord transport once per
 * subscriber, and writes exactly one `notification_log` row per subscriber
 * regardless of outcome. Zero subscribers → returns silently with zero rows
 * (VAL-NOTIF-012). Failures are isolated: a transport error on one subscriber
 * never aborts the loop or crashes the caller (VAL-NOTIF-008).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationLog)
    private readonly logRepo: Repository<NotificationLog>,
    private readonly transport: DiscordTransportService,
  ) {}

  /**
   * Fans out `payload` to `subscribers` for a given `source` + `referenceId`.
   * Writes one `notification_log` row per subscriber. Returns the persisted
   * rows (empty when `subscribers` is empty) so callers like the test
   * notification endpoint can surface the created row id.
   *
   * Never throws — per-subscriber failures are logged and the loop continues.
   */
  async fanOut(
    subscribers: Subscriber[],
    payload: FanOutPayload,
    source: NotificationSource,
    referenceId: string,
  ): Promise<NotificationLog[]> {
    if (subscribers.length === 0) {
      // Zero-subscriber case: no sentinel/placeholder rows, no error
      // (VAL-NOTIF-012).
      return [];
    }

    const rows: NotificationLog[] = [];
    for (const subscriber of subscribers) {
      try {
        const maskedUrl = maskWebhookUrl(subscriber.discordWebhookUrl);
        const rowPayload: Record<string, unknown> = {
          ...payload,
          subscriberId: subscriber.id,
          webhookUrl: maskedUrl,
        };
        const { status, error } = await this.transport.send(
          subscriber,
          rowPayload,
        );
        const saved = await this.logRepo.save(
          this.logRepo.create({
            subscriberId: subscriber.id,
            source,
            referenceId,
            payload: rowPayload,
            status,
            error,
          }),
        );
        rows.push(saved);
      } catch (err) {
        // Isolated failure: log and continue so one bad row never aborts the
        // whole fan-out or crashes the scheduler/trigger (VAL-NOTIF-008).
        this.logger.error(
          `fanOut failed for subscriber ${subscriber.id}: ` +
            `${(err as Error)?.message ?? 'unknown error'}`,
        );
      }
    }
    return rows;
  }

  /**
   * Lists `notification_log` rows belonging to `ownerId`'s subscribers, with
   * optional `source`/`status` filters and `page`/`limit` pagination. Ordered
   * newest-first (`delivered_at DESC`) for stable pagination. Over-page
   * returns `[]` (200). Cross-user rows are never returned because the query
   * joins `subscribers` on `owner_id` (VAL-NOTIF-009 / VAL-NOTIF-010).
   */
  async listForOwner(
    ownerId: string,
    options: {
      source?: NotificationSource;
      status?: NotificationStatus;
      page: number;
      limit: number;
    },
  ): Promise<PublicNotification[]> {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .where((qb) => {
        const sub = qb
          .subQuery()
          .select('s.id')
          .from(Subscriber, 's')
          .where('s.ownerId = :ownerId')
          .getQuery();
        return `log.subscriber_id IN ${sub}`;
      })
      .setParameter('ownerId', ownerId)
      .orderBy('log.delivered_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((options.page - 1) * options.limit)
      .take(options.limit);

    if (options.source) {
      qb.andWhere('log.source = :source', { source: options.source });
    }
    if (options.status) {
      qb.andWhere('log.status = :status', { status: options.status });
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.toPublic(row));
  }

  private toPublic(row: NotificationLog): PublicNotification {
    return {
      id: row.id,
      deliveredAt: row.deliveredAt,
      source: row.source,
      referenceId: row.referenceId,
      subscriberId: row.subscriberId,
      status: row.status,
      payload: row.payload,
      error: row.error,
    };
  }
}
