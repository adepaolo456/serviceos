import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Invoice } from './invoice.entity';
import { Customer } from '../../customers/entities/customer.entity';

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

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ name: 'payment_method' })
  payment_method!: string;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processed_at!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
