import { Controller, Get, Query } from '@nestjs/common';
import { ApodService } from './apod.service';
import { ListApodDto } from './dto/list-apod.dto';
import { Public } from '../../auth/public.decorator';

/**
 * Read-only APOD endpoints. Reads are public via `@Public()` so the
 * `services.yaml` healthcheck fallback and dev smoke tests work without a
 * token (architecture §4 / §7).
 */
@Public()
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
