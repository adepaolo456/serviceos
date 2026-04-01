import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_line_items')
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_id' })
  invoice_id!: string;

  @ManyToOne(() => Invoice, (inv) => inv.line_items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order!: number;

  @Column({ name: 'line_type' })
  line_type!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 1 })
  quantity!: number;

  @Column({ name: 'unit_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unit_rate!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount!: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount_amount!: number;

  @Column({ name: 'discount_type', nullable: true })
  discount_type!: string;

  @Column({ name: 'net_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  net_amount!: number;

  @Column({ name: 'is_taxable', default: false })
  is_taxable!: boolean;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 4, default: 0 })
  tax_rate!: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax_amount!: number;

  @Column({ name: 'service_date', type: 'date', nullable: true })
  service_date!: string;

  @Column({ name: 'service_address', type: 'jsonb', nullable: true })
  service_address!: Record<string, any>;

  @Column({ nullable: true })
  source!: string;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  source_id!: string;

  @Column({ type: 'jsonb', default: '{}' })
  cogs!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
