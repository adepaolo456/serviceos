import {
  IsString,
  IsOptional,
  IsEmail,
  IsObject,
  IsBoolean,
  IsIn,
  IsUUID,
  IsArray,
  IsNumber,
} from 'class-validator';

export class CreateWithBookingDto {
  // Existing customer (if selected from autocomplete)
  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Customer fields (used when creating new)
  @IsOptional()
  @IsIn(['residential', 'commercial'])
  type?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, any>;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  leadSource?: string;

  // Flow intent
  @IsIn(['customer_only', 'schedule_job'])
  intent: 'customer_only' | 'schedule_job';

  // Scheduling fields (required when intent === 'schedule_job')
  @IsOptional()
  @IsString()
  dumpsterSize?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  pickupDate?: string;

  @IsOptional()
  @IsBoolean()
  pickupTBD?: boolean;

  @IsOptional()
  @IsObject()
  siteAddress?: Record<string, any>;

  @IsOptional()
  @IsIn(['card', 'cash', 'check', 'invoice'])
  paymentMethod?: string;

  @IsOptional()
  @IsNumber()
  rentalDays?: number;

  // Idempotency
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  // Duplicate override
  @IsOptional()
  @IsBoolean()
  confirmedCreateDespiteDuplicate?: boolean;
}
