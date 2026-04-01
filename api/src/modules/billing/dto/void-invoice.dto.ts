import { IsString } from 'class-validator';

export class VoidInvoiceDto {
  @IsString()
  reason: string;
}
