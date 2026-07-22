import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscriber } from './entities/subscriber.entity';
import { EonetCategory } from '../nasa/eonet/entities/eonet-category.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscribersController } from './subscribers.controller';
import { SubscribersService } from './subscribers.service';
import { SubscriberMatcherService } from './subscriber-matcher.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscriber, EonetCategory]),
    NotificationsModule,
    AuthModule,
  ],
  controllers: [SubscribersController],
  providers: [SubscribersService, SubscriberMatcherService],
  exports: [SubscribersService, SubscriberMatcherService, TypeOrmModule],
})
export class SubscribersModule {}
