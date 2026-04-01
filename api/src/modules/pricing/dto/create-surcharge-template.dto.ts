import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateSurchargeTemplateDto {
  @IsString()
  name: string;

  @IsNumber()
  default_amount: number;

  @IsOptional()
  @IsBoolean()
  is_taxable?: boolean;
}
