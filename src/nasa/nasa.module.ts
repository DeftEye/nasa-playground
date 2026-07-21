import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApodEntry } from './apod/entities/apod-entry.entity';
import { EonetCategory } from './eonet/entities/eonet-category.entity';
import { EonetEvent } from './eonet/entities/eonet-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApodEntry, EonetCategory, EonetEvent])],
  exports: [TypeOrmModule],
})
export class NasaModule {}
