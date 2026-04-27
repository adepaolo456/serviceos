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

@Entity('tenant_fees')
export class TenantFee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'fee_key', length: 50 })
  fee_key!: string;

  @Column({ length: 100 })
  label!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount!: number;

  @Column({ name: 'is_percentage', default: false })
  is_percentage!: boolean;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'applies_to', length: 50, default: 'all' })
  applies_to!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
