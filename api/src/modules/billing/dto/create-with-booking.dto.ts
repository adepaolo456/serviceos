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
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JOB_SOURCE_VALUES, type JobSource } from '../../rental-chains/dto/create-rental-chain.dto';

/**
 * Phase 4B — server-authoritative credit override payload.
 *
 * When booking creation is blocked by a customer credit hold, an
 * eligible operator (admin/owner role + tenant policy with
 * `allow_office_override`) can include this payload to override the
 * block. The reason is required and must be non-empty (whitespace
 * trimmed). The backend validates eligibility, builds the audit
 * note from the JWT user + ISO timestamp + the supplied reason,
 * and writes it to the new job's placement_notes.
 */
export class CreditOverrideDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

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

  // Exchange support
  @IsOptional()
  @IsIn(['delivery', 'exchange'])
  jobType?: string;

  @IsOptional()
  @IsUUID()
  exchangeRentalChainId?: string;

  // Phase 4B — driver/placement notes for the new job. The
  // BookingsController.completeBooking path already accepts this
  // field; mirroring it here so the orchestration path can flow
  // notes through to BookingCompletionService too.
  @IsOptional()
  @IsString()
  placementNotes?: string;

  // Phase 4B — server-authoritative credit override. When the
  // customer is on a block-mode credit hold, an eligible operator
  // can include this to override. The backend validates eligibility
  // (role + tenant policy) and writes the audit note to placement
  // notes. Ignored when the customer is not on hold.
  @IsOptional()
  @ValidateNested()
  @Type(() => CreditOverrideDto)
  creditOverride?: CreditOverrideDto;

  // Origin source — must be in JOB_SOURCE_VALUES whitelist.
  @IsOptional()
  @IsString()
  @IsIn(JOB_SOURCE_VALUES)
  source?: JobSource;

  // Idempotency
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  // Duplicate override
  @IsOptional()
  @IsBoolean()
  confirmedCreateDespiteDuplicate?: boolean;
}
