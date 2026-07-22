import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Subscriber } from './entities/subscriber.entity';
import { EonetCategory } from '../nasa/eonet/entities/eonet-category.entity';
import { NotificationService } from '../notifications/notifications.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { UpdateSubscriberDto } from './dto/update-subscriber.dto';
import { maskWebhookUrl } from './webhook-redact';

/**
 * Public representation of a subscriber as returned by list/get endpoints.
 * The Discord webhook URL is NEVER included (architecture §13 / VAL-SUB-001 /
 * VAL-SUB-004 / VAL-CROSS-011).
 */
export interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  createdAt: Date;
}

// Webhook URL redaction lives in `./webhook-redact` so the notifications
// module can reuse it without a circular service import. Re-exported here for
// backward compatibility with any existing importers.
export { maskWebhookUrl } from './webhook-redact';
// (The `maskWebhookUrl` used internally below is imported above as a value.)

@Injectable()
export class SubscribersService {
  constructor(
    @InjectRepository(Subscriber)
    private readonly subscribers: Repository<Subscriber>,
    @InjectRepository(EonetCategory)
    private readonly categories: Repository<EonetCategory>,
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- Reads ----------

  /**
   * Lists all subscribers owned by `ownerId` with their category slugs.
   * Never exposes `discordWebhookUrl`.
   */
  async listByOwner(ownerId: string): Promise<PublicSubscriber[]> {
    const rows = await this.subscribers.find({
      where: { ownerId },
      relations: { categories: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => this.toPublic(row));
  }

  /**
   * Returns one subscriber owned by `ownerId` (with categories) or `null`.
   * Cross-user access returns `null` so the controller surfaces `404`.
   */
  async findOneOwned(ownerId: string, id: string): Promise<Subscriber | null> {
    return this.subscribers.findOne({
      where: { id, ownerId },
      relations: { categories: true },
    });
  }

  // ---------- Create ----------

  /**
   * Creates a subscriber owned by `ownerId`. Validates every slug in
   * `eonetCategorySlugs` against `eonet_categories` BEFORE any insert (atomic).
   * Empty array is valid (means "all EONET events").
   */
  async create(
    ownerId: string,
    dto: CreateSubscriberDto,
  ): Promise<PublicSubscriber> {
    const categoryRows = await this.resolveCategories(dto.eonetCategorySlugs);

    return this.dataSource.transaction(async (manager) => {
      const subscriber = manager.create(Subscriber, {
        ownerId,
        name: dto.name,
        discordWebhookUrl: dto.discordWebhookUrl,
        apodEnabled: dto.apodEnabled ?? true,
        enabled: dto.enabled ?? true,
        categories: categoryRows,
      });
      const saved = await manager.save(subscriber);
      // Re-load with categories populated (save doesn't always populate M2M).
      const withCats = await manager.findOne(Subscriber, {
        where: { id: saved.id },
        relations: { categories: true },
      });
      return this.toPublic(withCats ?? saved);
    });
  }

  // ---------- Update ----------

  /**
   * Updates a subscriber owned by `ownerId`. Tri-state handling of
   * `eonetCategorySlugs`:
   * - `undefined` (key absent) → categories unchanged.
   * - `null` (key present, value null) → `400`.
   * - array → atomic slug validation then full M2M replacement.
   *
   * Cross-owner id → `404`. Atomic: on unknown slug, NO partial M2M rows are
   * written.
   */
  async update(
    ownerId: string,
    id: string,
    dto: UpdateSubscriberDto,
  ): Promise<PublicSubscriber> {
    const existing = await this.findOneOwned(ownerId, id);
    if (!existing) {
      throw new NotFoundException();
    }

    if (dto.eonetCategorySlugs === null) {
      throw new BadRequestException({
        statusCode: 400,
        message: ['eonetCategorySlugs must be an array, received null'],
        error: 'Bad Request',
      });
    }

    // Validate slugs BEFORE any write so the M2M replacement is atomic.
    let newCategoryRows: EonetCategory[] | undefined;
    if (dto.eonetCategorySlugs !== undefined) {
      newCategoryRows = await this.resolveCategories(dto.eonetCategorySlugs);
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.name !== undefined) {
        await manager.update(Subscriber, { id, ownerId }, { name: dto.name });
      }
      if (dto.discordWebhookUrl !== undefined) {
        await manager.update(
          Subscriber,
          { id, ownerId },
          { discordWebhookUrl: dto.discordWebhookUrl },
        );
      }
      if (dto.apodEnabled !== undefined) {
        await manager.update(
          Subscriber,
          { id, ownerId },
          { apodEnabled: dto.apodEnabled },
        );
      }
      if (dto.enabled !== undefined) {
        await manager.update(
          Subscriber,
          { id, ownerId },
          { enabled: dto.enabled },
        );
      }

      if (newCategoryRows !== undefined) {
        // Atomic M2M replacement: load the managed entity, set categories,
        // save inside the same transaction.
        const managed = await manager.findOne(Subscriber, {
          where: { id, ownerId },
          relations: { categories: true },
        });
        if (managed) {
          managed.categories = newCategoryRows;
          await manager.save(managed);
        }
      }

      const refreshed = await manager.findOne(Subscriber, {
        where: { id, ownerId },
        relations: { categories: true },
      });
      return this.toPublic(refreshed ?? existing);
    });
  }

  // ---------- Delete ----------

  /**
   * Deletes a subscriber owned by `ownerId` (and its M2M rows via cascade).
   * Cross-owner id → `404` (no row touched).
   */
  async remove(ownerId: string, id: string): Promise<void> {
    const existing = await this.findOneOwned(ownerId, id);
    if (!existing) {
      throw new NotFoundException();
    }
    await this.subscribers.remove(existing);
  }

  // ---------- Test notification ----------

  /**
   * Sends a "test" notification through the (mocked-by-default) transport and
   * writes exactly one `notification_log` row with `source='test'`.
   *
   * **Ignores `subscriber.enabled`** — the endpoint's purpose is to verify
   * delivery regardless of the subscriber's enabled flag (VAL-SUB-010 /
   * VAL-SUB-014). In mock mode (default, `DISABLE_NOTIFICATION_MOCK` unset or
   * not `'true'`), no outbound Discord POST is made and the row's status is
   * `'mocked'`. In real mode, a POST to the subscriber's webhook URL is made
   * and the row's status is `'sent'` (2xx) or `'failed'` (non-2xx / error).
   *
   * Returns `{ id }` of the created `notification_log` row.
   */
  async sendTestNotification(
    ownerId: string,
    id: string,
  ): Promise<{ id: string }> {
    const subscriber = await this.findOneOwned(ownerId, id);
    if (!subscriber) {
      throw new NotFoundException();
    }

    const maskedUrl = maskWebhookUrl(subscriber.discordWebhookUrl);
    const payload = {
      content: `Test notification for subscriber "${subscriber.name}"`,
      embeds: [
        {
          title: 'Test notification',
          description: `Sent to ${subscriber.name} via Discord webhook ${maskedUrl}`,
        },
      ],
    };

    // Delegate to NotificationService.fanOut so the transport + log-write
    // logic lives in one place. `source='test'`, `referenceId=subscriber.id`.
    // The subscriber's `enabled` flag is intentionally ignored here
    // (VAL-SUB-010 / VAL-SUB-014).
    const rows = await this.notifications.fanOut(
      [subscriber],
      payload,
      'test',
      subscriber.id,
    );
    const row = rows[0];
    return { id: row.id };
  }

  // ---------- Helpers ----------

  /**
   * Resolves an array of slugs to `EonetCategory` rows, throwing a 400 with
   * the list of unknown slugs if ANY are missing. Atomic: never partial.
   */
  private async resolveCategories(slugs: string[]): Promise<EonetCategory[]> {
    if (slugs.length === 0) {
      return [];
    }
    const found = await this.categories.find({
      where: { id: In(slugs) },
    });
    if (found.length !== slugs.length) {
      const foundIds = new Set(found.map((c) => c.id));
      const unknown = slugs.filter((s) => !foundIds.has(s));
      throw new BadRequestException({
        statusCode: 400,
        message: [
          `eonetCategorySlugs contains unknown slug(s): ${unknown.join(', ')}`,
        ],
        error: 'Bad Request',
      });
    }
    // Preserve caller-supplied order; de-duplicate while preserving first
    // occurrence.
    const seen = new Set<string>();
    const ordered: EonetCategory[] = [];
    for (const slug of slugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const row = found.find((c) => c.id === slug);
      if (row) ordered.push(row);
    }
    return ordered;
  }

  private toPublic(subscriber: Subscriber): PublicSubscriber {
    return {
      id: subscriber.id,
      name: subscriber.name,
      apodEnabled: subscriber.apodEnabled,
      enabled: subscriber.enabled,
      eonetCategorySlugs: (subscriber.categories ?? []).map((c) => c.id).sort(),
      createdAt: subscriber.createdAt,
    };
  }
}
