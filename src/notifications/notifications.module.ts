import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationLog } from './entities/notification-log.entity';
import { DiscordTransportService } from './discord.transport';
import { NotificationService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationLog])],
  controllers: [NotificationsController],
  providers: [DiscordTransportService, NotificationService],
  exports: [NotificationService, DiscordTransportService, TypeOrmModule],
})
export class NotificationsModule {}
