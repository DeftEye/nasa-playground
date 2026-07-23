import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Query DTO for `GET /api/nasa/eonet/events/map` (architecture §16.1).
 *
 * - `days` optional int, one of `{7, 14, 30}`, default `30`.
 * - `category` optional category slug.
 * - `status` optional, one of `{'open', 'closed'}`.
 *
 * Invalid values surface as `400` via the global `ValidationPipe`, mirroring
 * the list endpoint's validation posture.
 */
export class MapEonetEventsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 14, 30], {
    message: 'days must be one of: 7, 14, 30',
  })
  days?: 7 | 14 | 30;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['open', 'closed'], {
    message: 'status must be one of: open, closed',
  })
  status?: 'open' | 'closed';
}
