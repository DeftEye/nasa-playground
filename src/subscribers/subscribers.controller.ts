import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SubscribersService } from './subscribers.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { UpdateSubscriberDto } from './dto/update-subscriber.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Subscriber CRUD + test-notification endpoint.
 *
 * All routes are JWT-guarded (per `@UseGuards(JwtAuthGuard)` and the global
 * `GlobalJwtAuthGuard`) and scoped to `req.user.id` — no subscriber owned by
 * another user is ever visible or mutable (VAL-SUB-004 / VAL-SUB-007 /
 * VAL-SUB-009 / VAL-CROSS-003).
 *
 * The Discord webhook URL is never echoed in any response (architecture §13 /
 * VAL-SUB-001 / VAL-SUB-004 / VAL-CROSS-011).
 */
@UseGuards(JwtAuthGuard)
@Controller('subscribers')
export class SubscribersController {
  constructor(private readonly subscribersService: SubscribersService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriberDto,
  ) {
    return this.subscribersService.create(user.userId, dto);
  }

  @Get()
  @HttpCode(200)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.subscribersService.listByOwner(user.userId);
  }

  @Patch(':id')
  @HttpCode(200)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriberDto,
  ) {
    return this.subscribersService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.subscribersService.remove(user.userId, id);
  }

  /**
   * Sends a single "test" notification through the transport and returns
   * `{ id }` of the created `notification_log` row. Ignores the subscriber's
   * `enabled` flag (VAL-SUB-010 / VAL-SUB-014).
   */
  @Post(':id/test-notification')
  @HttpCode(200)
  sendTestNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.subscribersService.sendTestNotification(user.userId, id);
  }
}
