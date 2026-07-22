import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { NasaHealthService } from './nasa-health.service';

/**
 * `GET /api/nasa/health` — reports DB and NASA reachability
 * (architecture §4 / VAL-CROSS-012).
 *
 * - DB reachable → `200` `{status:'ok', db:'up', nasaReachable:true|false}`.
 *   NASA reachability is informational and never downgrades a 200 to a 503.
 * - DB unreachable → `503` `{status:'down', db:'down', nasaReachable:false}`.
 *
 * Reads remain public (mirrors the APOD/EONET read policy this milestone) so
 * the `services.yaml` healthcheck works without a token.
 */
@Controller('nasa/health')
export class NasaHealthController {
  constructor(private readonly healthService: NasaHealthService) {}

  @Get()
  @HttpCode(200)
  async health(
    @Res({ passthrough: true }) res: { status: (code: number) => void },
  ) {
    const { body, dbUp } = await this.healthService.probe();
    if (!dbUp) {
      res.status(503);
    }
    return body;
  }
}
