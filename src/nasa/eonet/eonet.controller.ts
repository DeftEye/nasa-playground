import { Controller, Get, Query } from '@nestjs/common';
import { EonetService } from './eonet.service';
import { ListEonetEventsDto } from './dto/list-eonet-events.dto';

/**
 * Read-only EONET endpoints. Reads are public this milestone (mirrors the APOD
 * read policy) so the `services.yaml` healthcheck and dev smoke tests do not
 * require a token.
 */
@Controller('nasa/eonet')
export class EonetController {
  constructor(private readonly eonetService: EonetService) {}

  /** Returns all seeded categories as `{id, title, description?}`. */
  @Get('categories')
  async categories() {
    return this.eonetService.listCategories();
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
