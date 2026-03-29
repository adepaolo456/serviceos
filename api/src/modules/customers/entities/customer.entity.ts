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

  @Column({ name: 'tenant_id' })
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

  @Column({ name: 'tags', type: 'simple-array', nullable: true })
  tags!: string[];

  @Column({ name: 'lead_source', nullable: true })
  lead_source!: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripe_customer_id!: string;

  @Column({
    name: 'lifetime_revenue',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  lifetime_revenue!: number;

  @Column({ name: 'total_jobs', type: 'int', default: 0 })
  total_jobs!: number;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
