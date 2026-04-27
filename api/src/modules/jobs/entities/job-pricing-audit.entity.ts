import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('job_pricing_audit')
export class JobPricingAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'job_id', type: 'uuid' })
  job_id!: string;

  @Column({ name: 'previous_pricing_snapshot_id', type: 'uuid', nullable: true })
  previous_pricing_snapshot_id!: string | null;

  @Column({ name: 'new_pricing_snapshot_id', type: 'uuid', nullable: true })
  new_pricing_snapshot_id!: string | null;

  @Column({ name: 'recalculation_reasons', type: 'jsonb' })
  recalculation_reasons!: string[];

  @Column({ name: 'triggered_by', type: 'uuid', nullable: true })
  triggered_by!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
