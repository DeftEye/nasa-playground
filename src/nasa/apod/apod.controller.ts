import { Controller, Get, Query } from '@nestjs/common';
import { ApodService } from './apod.service';
import { ListApodDto } from './dto/list-apod.dto';

/**
 * Read-only APOD endpoints. Reads are public (architecture §4: reads are
 * JWT-guarded by default with an `AUTH_REQUIRED=false` dev toggle; for this
 * milestone reads remain public so the `services.yaml` healthcheck fallback
 * works and dev smoke tests do not require a token).
 */
@Controller('nasa/apod')
export class ApodController {
  constructor(private readonly apodService: ApodService) {}

  /** Returns today's APOD, fetching from NASA on miss (fetch-on-miss). */
  @Get('today')
  async today() {
    return this.apodService.getToday();
  }

  /** Paginated APOD archive ordered by date DESC with optional date range. */
  @Get()
  async list(@Query() query: ListApodDto) {
    return this.apodService.listPaginated({
      page: query.page,
      limit: query.limit,
      from: query.from,
      to: query.to,
    });
  }
}
