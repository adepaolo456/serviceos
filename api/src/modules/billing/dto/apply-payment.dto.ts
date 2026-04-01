import { IsNumber, IsString, IsOptional } from 'class-validator';

export class ApplyPaymentDto {
  @IsNumber()
  amount: number;

  @IsString()
  payment_method: string;

  @IsOptional()
  @IsString()
  stripe_payment_intent_id?: string;

  @IsOptional()
  @IsString()
  reference_number?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
