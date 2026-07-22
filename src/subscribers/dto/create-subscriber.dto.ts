import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

/**
 * Payload for `POST /api/subscribers`.
 *
 * `eonetCategorySlugs` is required: an empty array means "receive ALL EONET
 * events"; a non-empty array means "only matching categories". Slugs are
 * validated against `eonet_categories` in `SubscribersService` (the
 * `eonet_categories` table is seeded at runtime, so existence cannot be
 * checked by a class-validator decorator).
 */
export class CreateSubscriberDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsUrl()
  discordWebhookUrl: string;

  @IsOptional()
  @IsBoolean()
  apodEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsArray()
  @IsString({ each: true })
  eonetCategorySlugs: string[];
}
