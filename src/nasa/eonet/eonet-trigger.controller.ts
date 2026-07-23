import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { EonetService, EonetFetchResult } from './eonet.service';
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
  async fetchEonet(): Promise<EonetFetchResult> {
    return this.eonetService.fetchAndStore();
  }

  /**
   * Explicit backfill trigger for the full recent EONET window (open +
   * closed-within-window events). Idempotent: re-running does not duplicate
   * events. Returns the same diff summary as `fetch-eonet`
   * (VAL-PRODFIX-005 / VAL-PRODFIX-006). Mirrors the existing fetch-eonet
   * guard + 200 status code.
   */
  @Post('backfill-eonet')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async backfillEonet(): Promise<EonetFetchResult> {
    return this.eonetService.fetchAndStore();
  }
}
