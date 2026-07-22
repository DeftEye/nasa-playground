import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApodEntry } from './entities/apod-entry.entity';
import { ApodService } from './apod.service';
import { ApodController } from './apod.controller';
import { ApodTriggerController } from './apod-trigger.controller';
import {
  ApodScheduler,
  APOD_BACKOFF_MS,
  DEFAULT_APOD_BACKOFF_MS,
} from './apod.scheduler';
import { NasaClientService } from '../common';
import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { SubscribersModule } from '../../subscribers/subscribers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApodEntry]),
    AuthModule,
    NotificationsModule,
    SubscribersModule,
  ],
  controllers: [ApodController, ApodTriggerController],
  providers: [
    NasaClientService,
    ApodService,
    ApodScheduler,
    {
      provide: APOD_BACKOFF_MS,
      useValue: DEFAULT_APOD_BACKOFF_MS,
    },
  ],
  exports: [ApodService, NasaClientService],
})
export class ApodModule {}
