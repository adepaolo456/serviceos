import {
  IsString,
  IsUUID,
  IsOptional,
  IsDateString,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateLineItemDto } from './create-line-item.dto';

export class CreateInvoiceDto {
  @IsUUID()
  customer_id: string;

  @IsOptional()
  @IsString()
  customer_type?: string;

  @IsOptional()
  @IsObject()
  billing_address?: Record<string, any>;

  @IsOptional()
  @IsObject()
  service_address?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  invoice_date?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsDateString()
  service_date?: string;

  @IsOptional()
  @IsUUID()
  job_id?: string;

  @IsOptional()
  @IsUUID()
  rental_chain_id?: string;

  @IsOptional()
  @IsString()
  project_name?: string;

  @IsOptional()
  @IsString()
  po_number?: string;

  @IsOptional()
  @IsUUID()
  terms_template_id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLineItemDto)
  line_items?: CreateLineItemDto[];
}
