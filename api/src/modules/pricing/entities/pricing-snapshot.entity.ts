import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('pricing_snapshots')
export class PricingSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string | null;

  @Column({ name: 'request_inputs', type: 'jsonb' })
  request_inputs!: Record<string, unknown>;

  @Column({ name: 'pricing_outputs', type: 'jsonb' })
  pricing_outputs!: Record<string, unknown>;

  @Column({ name: 'pricing_config_version_id', type: 'uuid', nullable: true })
  pricing_config_version_id!: string | null;

  @Column({ name: 'engine_version', length: 20, default: 'v2' })
  engine_version!: string;

  @CreateDateColumn({ name: 'calculated_at' })
  calculated_at!: Date;

  @Column({ default: true })
  locked!: boolean;

  @Column({ name: 'recalculated_from', type: 'uuid', nullable: true })
  recalculated_from!: string | null;
}
