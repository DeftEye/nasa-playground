import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApodService, isIsoDate } from './apod.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

/**
 * Manual APOD trigger endpoints (JWT-guarded writes). Lives under
 * `/api/nasa/triggers/*` per architecture §4.
 */
@Controller('nasa/triggers')
export class ApodTriggerController {
  constructor(private readonly apodService: ApodService) {}

  /**
   * Upserts an APOD row for the optional `?date=YYYY-MM-DD` (default: today).
   * Idempotent: re-triggering the same date does not create a duplicate row,
   * only refreshes `fetched_at`.
   */
  @Post('fetch-apod')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async fetchApod(@Query('date') date?: string) {
    if (date !== undefined && date !== '' && !isIsoDate(date)) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    const target = date && date !== '' ? date : undefined;
    return this.apodService.fetchStoreAndNotify(target);
  }
}
