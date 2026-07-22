import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query DTO for `GET /api/nasa/eonet/events`. Pagination defaults: `page=1`,
 * `limit=50`. Max `limit=100`. Optional `category` (slug) and `status`
 * (`open`|`closed`) filters. Invalid pagination or status surfaces as 400 via
 * the global `ValidationPipe`.
 */
export class ListEonetEventsDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['open', 'closed'], {
    message: 'status must be one of: open, closed',
  })
  status?: 'open' | 'closed';

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
  limit: number = 50;
}
