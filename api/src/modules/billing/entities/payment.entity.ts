import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Invoice } from './invoice.entity';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'invoice_id' })
  invoice_id!: string;

  @ManyToOne(() => Invoice, (inv) => inv.payments)
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ name: 'payment_method' })
  payment_method!: string;

  @Column({ name: 'stripe_payment_intent_id', nullable: true })
  stripe_payment_intent_id!: string;

  @Column({ name: 'reference_number', nullable: true })
  reference_number!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ default: 'completed' })
  status!: string;

  @Column({ name: 'refunded_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  refunded_amount!: number;

  @Column({ name: 'refund_provider_status', type: 'text', nullable: true })
  refund_provider_status!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', default: () => 'NOW()' })
  applied_at!: Date;

  @Column({ name: 'applied_by', type: 'uuid', nullable: true })
  applied_by!: string;
}
