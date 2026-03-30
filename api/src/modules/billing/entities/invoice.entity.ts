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
import { Customer } from '../../customers/entities/customer.entity';
import { Job } from '../../jobs/entities/job.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'invoice_number', unique: true })
  invoice_number!: string;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ default: 'draft' })
  status!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  due_date!: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  subtotal!: number;

  @Column({
    name: 'tax_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  tax_rate!: number;

  @Column({
    name: 'tax_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  tax_amount!: number;

  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  discount_amount!: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  total!: number;

  @Column({
    name: 'amount_paid',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  amount_paid!: number;

  @Column({
    name: 'balance_due',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  balance_due!: number;

  @Column({ name: 'line_items', type: 'jsonb', default: '[]' })
  line_items!: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;

  @Column({ nullable: true })
  source!: string; // booking, dump_slip, exchange, extra_days, failed_trip

  @Column({ name: 'invoice_type', nullable: true })
  invoice_type!: string; // rental, overage, exchange, extra_days, failure_charge

  @Column({ name: 'payment_method', nullable: true })
  payment_method!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sent_at!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paid_at!: Date;

  @Column({ name: 'stripe_payment_intent_id', nullable: true })
  stripe_payment_intent_id!: string;

  @Column({ name: 'stripe_charge_id', nullable: true })
  stripe_charge_id!: string;

  @Column({ name: 'stripe_refund_id', nullable: true })
  stripe_refund_id!: string;

  @Column({ name: 'viewed_at', type: 'timestamptz', nullable: true })
  viewed_at!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
