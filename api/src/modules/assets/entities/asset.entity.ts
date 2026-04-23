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
import { Yard } from '../../yards/yard.entity';

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

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ type: 'jsonb', nullable: true, default: '{}' })
  metadata!: Record<string, any>;

  // Retire metadata — populated atomically by AssetsService.retire().
  // retired_at = NULL is the canonical signal for "not retired"; status
  // remains the primary lifecycle flag. Cleared by unretire().
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retired_at!: Date | null;

  @Column({ name: 'retired_by', type: 'uuid', nullable: true })
  retired_by!: string | null;

  @Column({ name: 'retired_reason', type: 'varchar', length: 20, nullable: true })
  retired_reason!: string | null;

  @Column({ name: 'retired_notes', type: 'text', nullable: true })
  retired_notes!: string | null;

  @Column({ name: 'staged_at', type: 'timestamptz', nullable: true })
  staged_at!: Date;

  @Column({ name: 'staged_from_job_id', type: 'uuid', nullable: true })
  staged_from_job_id!: string;

  @Column({ name: 'staged_waste_type', nullable: true })
  staged_waste_type!: string;

  @Column({ name: 'staged_notes', type: 'text', nullable: true })
  staged_notes!: string;

  @Column({ name: 'needs_dump', default: false })
  needs_dump!: boolean;

  @Column({ name: 'yard_id', type: 'uuid', nullable: true })
  yard_id!: string;

  @ManyToOne(() => Yard)
  @JoinColumn({ name: 'yard_id' })
  yard!: any; // Yard entity

  @Column({ name: 'operational_history', type: 'jsonb', default: '[]' })
  operational_history!: Array<{
    event: string;
    timestamp: string;
    actor_id?: string;
    actor_role?: string;
    job_id?: string;
    yard_id?: string;
    yard_name?: string;
    details?: Record<string, unknown>;
  }>;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
