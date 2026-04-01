import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Invoice } from './invoice.entity';
import { Customer } from '../../customers/entities/customer.entity';

@Entity('credit_memos')
export class CreditMemo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'memo_number', type: 'int', default: 1 })
  memo_number!: number;

  @Column({ name: 'original_invoice_id' })
  original_invoice_id!: string;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'original_invoice_id' })
  original_invoice!: Invoice;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ default: 'issued' })
  status!: string;

  @Column({ name: 'applied_to_invoice_id', type: 'uuid', nullable: true })
  applied_to_invoice_id!: string;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'applied_to_invoice_id' })
  applied_to_invoice!: Invoice;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
