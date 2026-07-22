import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { NotificationService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Notification log query endpoints.
 *
 * `GET /api/notifications` is JWT-guarded (via the global `GlobalJwtAuthGuard`)
 * and scoped to `req.user.id` — only log rows belonging to the requesting
 * user's subscribers are returned. `payload` is included with the redacted
 * webhook URL (VAL-NOTIF-007 / VAL-NOTIF-009).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Returns the requesting user's notification log rows filtered by optional
   * `source`/`status` and paginated by `page`/`limit` (default 20, max 100).
   * Over-page returns `[]` (200); `?limit=200` → 400 via the validation pipe.
   */
  @Get()
  @HttpCode(200)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationService.listForOwner(user.userId, {
      source: query.source,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }
}
