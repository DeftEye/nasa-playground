import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApodModule } from './apod/apod.module';
import { EonetModule } from './eonet/eonet.module';
import { NasaHealthModule } from './health/nasa-health.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ApodModule,
    EonetModule,
    NasaHealthModule,
  ],
})
export class NasaModule {}
