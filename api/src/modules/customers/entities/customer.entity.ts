import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'account_id', nullable: true, unique: true })
  account_id!: string;

  @Column({ default: 'residential' })
  type!: string;

  @Column({ name: 'customer_preferences', type: 'jsonb', nullable: true, default: '{}' })
  customer_preferences!: Record<string, unknown>;

  @Column({ name: 'company_name', nullable: true })
  company_name!: string;

  @Column({ name: 'first_name' })
  first_name!: string;

  @Column({ name: 'last_name' })
  last_name!: string;

  @Column({ nullable: true })
  email!: string;

  @Column({ nullable: true })
  phone!: string;

  @Column({ name: 'billing_address', type: 'jsonb', nullable: true })
  billing_address!: Record<string, any>;

  @Column({
    name: 'service_addresses',
    type: 'jsonb',
    nullable: true,
    default: '[]',
  })
  service_addresses!: Record<string, any>[];

  @Column({ type: 'text', nullable: true })
  notes!: string;

  // Driver-facing instructions (separate from internal notes above).
  // Surfaced on the customer dashboard and consumed by the driver app
  // operational views. Nullable — empty means "no special instructions".
  @Column({ name: 'driver_instructions', type: 'text', nullable: true })
  driver_instructions!: string | null;

  @Column({ name: 'tags', type: 'simple-array', nullable: true })
  tags!: string[];

  @Column({ name: 'lead_source', nullable: true })
  lead_source!: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripe_customer_id!: string;

  @Column({ name: 'pricing_tier', default: 'standard' })
  pricing_tier!: string;

  @Column({ name: 'discount_percentage', type: 'decimal', precision: 5, scale: 2, nullable: true })
  discount_percentage!: number;

  @Column({ name: 'exempt_extra_day_charges', default: false })
  exempt_extra_day_charges!: boolean;

  @Column({ name: 'custom_pricing', type: 'jsonb', nullable: true })
  custom_pricing!: Record<string, { basePrice?: number; includedTons?: number; overageRate?: number }>;

  @Column({ name: 'pricing_notes', type: 'text', nullable: true })
  pricing_notes!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  // ── Phase 1: Credit-control foundation (schema only) ──────────
  // These columns are populated by future phases. In Phase 1 they
  // are stored on writes but no application code reads or enforces
  // them. See migrations/2026-04-09-credit-control-foundation.sql.
  //
  // payment_terms: customer-specific override for invoice payment
  // terms. NULL means "use the tenant default credit policy". The
  // database CHECK constraint enforces the allowed enum values; the
  // TypeScript const at api/src/modules/customers/payment-terms.ts
  // mirrors them for application-level type safety.
  @Column({ name: 'payment_terms', type: 'text', nullable: true })
  payment_terms!: string | null;

  // credit_limit: customer-specific credit ceiling (USD). NULL means
  // "no customer-specific override; use tenant default if any". Not
  // enforced anywhere in Phase 1.
  @Column({ name: 'credit_limit', type: 'decimal', precision: 12, scale: 2, nullable: true })
  credit_limit!: number | null;

  // credit_hold: explicit manual hold flag. FALSE by default. Future
  // phases will block dispatch / booking when TRUE. Phase 1 stores
  // it but does NOT consult it.
  @Column({ name: 'credit_hold', type: 'boolean', default: false })
  credit_hold!: boolean;

  // Hold audit metadata. When the hold flips TRUE, set_by/set_at/
  // reason must be populated in the same write. When the hold is
  // released, credit_hold flips back to FALSE and released_by/
  // released_at are populated while set_by/set_at/reason stay intact
  // as forensic history.
  @Column({ name: 'credit_hold_reason', type: 'text', nullable: true })
  credit_hold_reason!: string | null;

  @Column({ name: 'credit_hold_set_by', type: 'uuid', nullable: true })
  credit_hold_set_by!: string | null;

  @Column({ name: 'credit_hold_set_at', type: 'timestamptz', nullable: true })
  credit_hold_set_at!: Date | null;

  @Column({ name: 'credit_hold_released_by', type: 'uuid', nullable: true })
  credit_hold_released_by!: string | null;

  @Column({ name: 'credit_hold_released_at', type: 'timestamptz', nullable: true })
  credit_hold_released_at!: Date | null;

  @Column({ name: 'portal_password_hash', nullable: true, select: false })
  portal_password_hash!: string;

  @Column({ name: 'portal_last_login', type: 'timestamptz', nullable: true })
  portal_last_login!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
