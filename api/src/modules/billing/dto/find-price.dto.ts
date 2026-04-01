import { IsUUID, IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class FindPriceDto {
  @IsUUID()
  customer_id: string;

  @IsString()
  dumpster_size: string;

  @IsOptional()
  @IsNumber()
  rental_days?: number;

  @IsOptional()
  @IsObject()
  service_address?: Record<string, any>;
}
