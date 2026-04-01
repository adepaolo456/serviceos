import { IsUUID, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateClientSurchargeOverrideDto {
  @IsUUID()
  customer_id: string;

  @IsUUID()
  surcharge_template_id: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsBoolean()
  available_for_billing?: boolean;
}
