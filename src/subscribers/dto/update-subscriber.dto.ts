import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

/**
 * Payload for `PATCH /api/subscribers/:id`.
 *
 * All fields are optional (PATCH semantics). The `eonetCategorySlugs` field is
 * tri-state and handled specially in `SubscribersService`:
 *
 * - **key absent** (`undefined` after DTO instantiation) → categories are left
 *   unchanged (the field is omitted, not cleared). VAL-SUB-013.
 * - **key present with `null`** → `400`. The service throws a
 *   `BadRequestException` naming the field. Architecture §4 + feature spec.
 * - **key present with an array** → slugs are validated against
 *   `eonet_categories`; if any slug is unknown the call is rejected with `400`
 *   naming each unknown slug AND no partial M2M rows are written (atomic).
 *   VAL-SUB-005 / VAL-SUB-006 / VAL-SUB-012.
 *
 * Because `@IsOptional()` skips validation when the value is `undefined` OR
 * `null`, the `null` case reaches the service untouched and is rejected there
 * with a clear error referencing the field.
 */
export class UpdateSubscriberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUrl()
  discordWebhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  apodEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eonetCategorySlugs?: string[] | null;
}
