import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsDateString,
  IsObject,
} from 'class-validator';

export class CreateLineItemDto {
  @IsString()
  @IsNotEmpty()
  line_type: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unit_rate: number;

  @IsOptional()
  @IsBoolean()
  is_taxable?: boolean;

  @IsOptional()
  @IsNumber()
  tax_rate?: number;

  @IsOptional()
  @IsNumber()
  discount_amount?: number;

  @IsOptional()
  @IsString()
  discount_type?: string;

  @IsOptional()
  @IsDateString()
  service_date?: string;

  @IsOptional()
  @IsObject()
  service_address?: Record<string, any>;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsUUID()
  source_id?: string;
}
