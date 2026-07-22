import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query DTO for `GET /api/notifications`. Pagination defaults: `page=1`,
 * `limit=20`. Max `limit=100` (so `?limit=200` → 400 via the global
 * `ValidationPipe`). Optional `source` (`apod`|`eonet`|`test`) and `status`
 * (`sent`|`mocked`|`failed`) filters are applied as an intersection.
 */
export class ListNotificationsDto {
  @IsOptional()
  @IsIn(['apod', 'eonet', 'test'], {
    message: 'source must be one of: apod, eonet, test',
  })
  source?: 'apod' | 'eonet' | 'test';

  @IsOptional()
  @IsIn(['sent', 'mocked', 'failed'], {
    message: 'status must be one of: sent, mocked, failed',
  })
  status?: 'sent' | 'mocked' | 'failed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
