import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ISO_DATE_REGEX } from '../apod.service';

/**
 * Query DTO for `GET /api/nasa/apod`. Pagination defaults: `page=1`,
 * `limit=20`. Max `limit=100`. Optional inclusive `from`/`to` `YYYY-MM-DD`
 * date range. Invalid pagination or date formats surface as 400 via the global
 * `ValidationPipe`.
 */
export class ListApodDto {
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

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'from must be a valid YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_REGEX, { message: 'to must be a valid YYYY-MM-DD date' })
  to?: string;
}
