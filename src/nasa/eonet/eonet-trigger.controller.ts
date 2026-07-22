import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { EonetService } from './eonet.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

/**
 * Manual EONET trigger endpoint (JWT-guarded write). Lives under
 * `/api/nasa/triggers/*` alongside the APOD trigger; the distinct route path
 * `fetch-eonet` avoids any collision with `fetch-apod`.
 */
@Controller('nasa/triggers')
export class EonetTriggerController {
  constructor(private readonly eonetService: EonetService) {}

  /**
   * Seeds categories (if empty), fetches open + bounded-closed events, persists
   * them with M2M links, and returns a diff summary `{detected, updated,
   * skipped, unchanged}`. Always returns 2xx even when some events are skipped
   * due to malformed geometry.
   */
  @Post('fetch-eonet')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async fetchEonet() {
    return this.eonetService.fetchAndStore();
  }
}
