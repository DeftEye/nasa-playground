import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApodModule } from './apod/apod.module';
import { EonetCategory } from './eonet/entities/eonet-category.entity';
import { EonetEvent } from './eonet/entities/eonet-event.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ApodModule,
    // EONET entities registered here so synchronize keeps their tables present
    // until the EonetModule lands in m2-eonet-end-to-end.
    TypeOrmModule.forFeature([EonetCategory, EonetEvent]),
  ],
})
export class NasaModule {}
