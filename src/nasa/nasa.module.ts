import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApodModule } from './apod/apod.module';
import { EonetModule } from './eonet/eonet.module';

@Module({
  imports: [ScheduleModule.forRoot(), ApodModule, EonetModule],
})
export class NasaModule {}
