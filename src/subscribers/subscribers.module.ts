import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscriber } from './entities/subscriber.entity';
import { EonetCategory } from '../nasa/eonet/entities/eonet-category.entity';
import { NotificationLog } from '../notifications/entities/notification-log.entity';
import { SubscribersController } from './subscribers.controller';
import { SubscribersService } from './subscribers.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscriber, EonetCategory, NotificationLog]),
    AuthModule,
  ],
  controllers: [SubscribersController],
  providers: [SubscribersService],
  exports: [SubscribersService, TypeOrmModule],
})
export class SubscribersModule {}
