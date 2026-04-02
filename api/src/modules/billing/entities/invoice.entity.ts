import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Job } from '../../jobs/entities/job.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { InvoiceRevision } from './invoice-revision.entity';
import { Payment } from './payment.entity';

@Entity('invoices')
@Index('idx_invoices_tenant', ['tenant_id'])
@Index('idx_invoices_customer', ['customer_id'])
@Index('idx_invoices_status', ['tenant_id', 'status'])
@Index('idx_invoices_number', ['tenant_id', 'invoice_number'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'invoice_number', type: 'int' })
  invoice_number!: number;

  @Column({ type: 'int', default: 1 })
  revision!: number;

  @Column({ name: 'parent_invoice_id', type: 'uuid', nullable: true })
  parent_invoice_id!: string;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'parent_invoice_id' })
  parent_invoice!: Invoice;

  @Column({ default: 'draft' })
  status!: string;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'customer_type', default: 'residential' })
  customer_type!: string;

  @Column({ name: 'billing_address', type: 'jsonb', nullable: true })
  billing_address!: Record<string, any>;

  @Column({ name: 'service_address', type: 'jsonb', nullable: true })
  service_address!: Record<string, any>;

  @Column({ name: 'invoice_date', type: 'date' })
  invoice_date!: string;

  @Column({ name: 'due_date', type: 'date' })
  due_date!: string;

  @Column({ name: 'service_date', type: 'date', nullable: true })
  service_date!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal!: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax_amount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  total!: number;

  @Column({ name: 'amount_paid', type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount_paid!: number;

  @Column({ name: 'balance_due', type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance_due!: number;

  @Column({ name: 'total_cogs', type: 'decimal', precision: 10, scale: 2, default: 0 })
  total_cogs!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  profit!: number;

  @Column({ name: 'summary_of_work', type: 'text', nullable: true })
  summary_of_work!: string;

  @Column({ name: 'terms_template_id', type: 'uuid', nullable: true })
  terms_template_id!: string;

  @Column({ name: 'terms_text', type: 'text', nullable: true })
  terms_text!: string;

  @Column({ name: 'project_name', nullable: true })
  project_name!: string;

  @Column({ name: 'po_number', nullable: true })
  po_number!: string;

  @Column({ name: 'pricing_tier_used', default: 'global' })
  pricing_tier_used!: string;

  @Column({ name: 'pricing_rule_snapshot', type: 'jsonb', nullable: true })
  pricing_rule_snapshot!: Record<string, any>;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'rental_chain_id', type: 'uuid', nullable: true })
  rental_chain_id!: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sent_at!: Date;

  @Column({ name: 'sent_method', nullable: true })
  sent_method!: string;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  delivered_at!: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  read_at!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paid_at!: Date;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voided_at!: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updated_by!: string;

  // Collections tracking fields
  @Column({ name: 'last_contacted_at', type: 'timestamptz', nullable: true })
  last_contacted_at!: Date;

  @Column({ name: 'contact_attempt_count', type: 'int', default: 0 })
  contact_attempt_count!: number;

  @Column({ name: 'last_contact_method', nullable: true })
  last_contact_method!: string;

  @Column({ name: 'promise_to_pay_date', type: 'date', nullable: true })
  promise_to_pay_date!: string;

  @Column({ name: 'promise_to_pay_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  promise_to_pay_amount!: number;

  @Column({ name: 'dispute_status', default: 'none' })
  dispute_status!: string;

  @Column({ name: 'dispute_notes', type: 'text', nullable: true })
  dispute_notes!: string;

  @OneToMany(() => InvoiceLineItem, (li) => li.invoice)
  line_items!: InvoiceLineItem[];

  @OneToMany(() => Payment, (p) => p.invoice)
  payments!: Payment[];

  @OneToMany(() => InvoiceRevision, (r) => r.invoice)
  revisions!: InvoiceRevision[];

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
