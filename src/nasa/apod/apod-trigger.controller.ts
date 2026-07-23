import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApodEntry } from './entities/apod-entry.entity';
import { ApodService, isIsoDate } from './apod.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

/** Minimum / default backfill window size in days. */
const BACKFILL_DEFAULT_DAYS = 30;
/** Maximum backfill window size in days (history is bounded to 30). */
const BACKFILL_MAX_DAYS = 30;

/**
 * Parses the `days` query parameter for the backfill endpoint. Returns the
 * default (30) when the value is absent or empty, or throws a
 * `BadRequestException` when the value is present but not an integer in
 * `[1, 30]`.
 */
function parseBackfillDays(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return BACKFILL_DEFAULT_DAYS;
  }
  // Reject non-integer strings (e.g. "1.5", "abc"). `Number('1.5')` would
  // otherwise coerce to 1.5 and pass the range check below.
  if (!/^-?\d+$/.test(raw)) {
    throw new BadRequestException('days must be an integer between 1 and 30');
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > BACKFILL_MAX_DAYS) {
    throw new BadRequestException('days must be an integer between 1 and 30');
  }
  return days;
}

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

  /**
   * Backfills the last `days` (default 30, max 30) consecutive dated APOD
   * rows. Idempotent: a re-run upserts each date (no duplicate rows), only
   * refreshing `fetched_at`. Safe on a NON-empty table. The endpoint mirrors
   * the existing `fetch-apod` guard + 200 status code (VAL-PRODFIX-004 /
   * VAL-PRODFIX-006).
   */
  @Post('backfill-apod')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async backfillApod(@Query('days') days?: string): Promise<ApodEntry[]> {
    const parsed = parseBackfillDays(days);
    return this.apodService.backfill(parsed);
  }
}
