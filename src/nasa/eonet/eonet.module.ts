import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EonetCategory } from './entities/eonet-category.entity';
import { EonetEvent } from './entities/eonet-event.entity';
import { EonetService } from './eonet.service';
import { EonetController } from './eonet.controller';
import { EonetTriggerController } from './eonet-trigger.controller';
import {
  EonetScheduler,
  EONET_BACKOFF_MS,
  DEFAULT_EONET_BACKOFF_MS,
} from './eonet.scheduler';
import { NasaClientService } from '../common';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([EonetCategory, EonetEvent]), AuthModule],
  controllers: [EonetController, EonetTriggerController],
  providers: [
    NasaClientService,
    EonetService,
    EonetScheduler,
    {
      provide: EONET_BACKOFF_MS,
      useValue: DEFAULT_EONET_BACKOFF_MS,
    },
  ],
  exports: [EonetService, NasaClientService],
})
export class EonetModule {}
