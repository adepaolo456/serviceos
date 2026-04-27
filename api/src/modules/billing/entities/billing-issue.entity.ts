import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Invoice } from './invoice.entity';
import { Job } from '../../jobs/entities/job.entity';

@Entity('billing_issues')
export class BillingIssue {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'issue_type' })
  issue_type!: string;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoice_id!: string;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'rental_chain_id', type: 'uuid', nullable: true })
  rental_chain_id!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'suggested_action', type: 'text', nullable: true })
  suggested_action!: string;

  @Column({ name: 'auto_resolvable', default: false })
  auto_resolvable!: boolean;

  @Column({ name: 'calculated_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  calculated_amount!: number;

  @Column({ name: 'days_overdue', type: 'int', nullable: true })
  days_overdue!: number;

  @Column({ default: 'open' })
  status!: string;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolved_by!: string;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolved_at!: Date;

  @Column({ name: 'resolution_reason', type: 'text', nullable: true })
  resolution_reason!: string;

  /**
   * Phase 6 — high-level audit category. Constrained at the database
   * level via CHECK constraint to one of:
   *   'paid' | 'operator_resolved' | 'legacy_cleanup' | 'stale_auto_resolved'
   *
   * Works alongside `resolution_reason` (which holds the detailed
   * pass-specific string like 'auto_cleared_balance_paid'). This
   * column is the audit-friendly classification; the reason column
   * keeps the forensic detail.
   *
   * See migrations/2026-04-09-billing-issues-resolution-category.sql
   * for the schema definition and BillingAuditService for the
   * classification + cleanup pipeline that consumes it.
   */
  @Column({ name: 'resolution_category', type: 'text', nullable: true })
  resolution_category!: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolution_notes!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
