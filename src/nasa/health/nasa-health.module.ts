import { Module } from '@nestjs/common';
import { NasaClientService } from '../common';
import { NasaHealthController } from './nasa-health.controller';
import { NasaHealthService } from './nasa-health.service';

/**
 * Health module for the NASA API surface. Registers the
 * `GET /api/nasa/health` endpoint which probes Postgres and NASA
 * reachability (architecture §4 / VAL-CROSS-012). The DataSource is injected
 * from the root `TypeOrmModule.forRoot`; no `forFeature` repositories needed.
 */
@Module({
  controllers: [NasaHealthController],
  providers: [NasaHealthService, NasaClientService],
  exports: [NasaHealthService],
})
export class NasaHealthModule {}
