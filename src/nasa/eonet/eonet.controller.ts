import { Controller, Get, Query } from '@nestjs/common';
import { EonetService } from './eonet.service';
import { ListEonetEventsDto } from './dto/list-eonet-events.dto';
import { MapEonetEventsDto } from './dto/map-eonet-events.dto';
import { Public } from '../../auth/public.decorator';

/**
 * Read-only EONET endpoints. Reads are public via `@Public()` so the
 * `services.yaml` healthcheck and dev smoke tests work without a token
 * (architecture §4 / §7).
 */
@Public()
@Controller('nasa/eonet')
export class EonetController {
  constructor(private readonly eonetService: EonetService) {}

  /** Returns all seeded categories as `{id, title, description?}`. */
  @Get('categories')
  async categories() {
    return this.eonetService.listCategories();
  }

  /**
   * Map-ready EONET events with normalized `{lat, lng}` per event and joined
   * categories (architecture §16.1). Public read-only. `days` defaults to 30
   * and is constrained to `{7, 14, 30}`; optional `category` (slug) and
   * `status` (`open`|`closed`) filters apply as an intersection. Invalid
   * params surface as 400 via the global `ValidationPipe`. Returns a bare
   * `{window, events}` envelope (NOT the paginated list envelope) and does
   * not alter the existing `/events` list endpoint.
   */
  @Get('events/map')
  async eventsMap(@Query() query: MapEonetEventsDto) {
    return this.eonetService.listEventsForMap({
      days: query.days ?? 30,
      category: query.category,
      status: query.status,
    });
  }

  /**
   * Paginated EONET events with optional `category` (slug) and `status`
   * (`open`|`closed`) filters applied as an intersection. Defaults: `page=1`,
   * `limit=50`. Invalid status/pagination surfaces as 400 via the global
   * `ValidationPipe`.
   */
  @Get('events')
  async events(@Query() query: ListEonetEventsDto) {
    return this.eonetService.listEvents({
      category: query.category,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }
}
