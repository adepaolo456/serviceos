import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  IsBoolean,
  IsIn,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  default_rental_period_days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  failed_trip_fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  time_change_cutoff_hours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'brand_color must be a valid hex color (#XXXXXX)' })
  brand_color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  support_email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  support_phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'portal_slug must be lowercase alphanumeric with hyphens only' })
  portal_slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email_sender_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sms_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  driver_hourly_rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  helper_hourly_rate?: number;
}

export class UpdateBrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'brand_color must be a valid hex color (#XXXXXX)' })
  brand_color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  support_email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  support_phone?: string;
}

export class UpdateOperationsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  default_rental_period_days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  failed_trip_fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  time_change_cutoff_hours?: number;
}

export class UpdateNotificationConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email_sender_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sms_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email_enabled?: boolean;
}

export class UpdateQuoteSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365)
  quote_expiration_days?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100)
  hot_quote_view_threshold?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10080)
  follow_up_recency_minutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(720)
  expiring_soon_hours?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  quotes_email_enabled?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  quotes_sms_enabled?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsIn(['email', 'sms', 'both'])
  default_quote_delivery_method?: string;
}
