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

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'asset_type' })
  asset_type!: string;

  @Column({ nullable: true })
  subtype!: string;

  @Column()
  identifier!: string;

  @Column({ default: 'available' })
  status!: string;

  @Column({ name: 'condition', nullable: true })
  condition!: string;

  @Column({ name: 'current_location_type', nullable: true })
  current_location_type!: string;

  @Column({ name: 'current_location', type: 'jsonb', nullable: true })
  current_location!: Record<string, any>;

  @Column({ name: 'current_job_id', type: 'uuid', nullable: true })
  current_job_id!: string;

  @Column({
    name: 'weight_capacity',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  weight_capacity!: number;

  @Column({
    name: 'daily_rate',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  daily_rate!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ type: 'jsonb', nullable: true, default: '{}' })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
