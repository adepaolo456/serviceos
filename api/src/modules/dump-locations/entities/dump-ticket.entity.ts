import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';

@Entity('dump_tickets')
@Unique('uq_dump_ticket_job_ticket', ['job_id', 'ticket_number'])
export class DumpTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'job_id' })
  job_id!: string;

  @ManyToOne(() => Job)
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'dump_location_id', type: 'uuid' })
  dump_location_id!: string;

  @Column({ name: 'dump_location_name' })
  dump_location_name!: string;

  @Column({ name: 'ticket_number', nullable: true })
  ticket_number!: string;

  @Column({ name: 'ticket_photo', type: 'text', nullable: true })
  ticket_photo!: string;

  @Column({ name: 'waste_type' })
  waste_type!: string;

  @Column({ name: 'weight_tons', type: 'decimal', precision: 8, scale: 2 })
  weight_tons!: number;

  @Column({ name: 'base_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  base_cost!: number;

  @Column({ name: 'overage_items', type: 'jsonb', default: '[]' })
  overage_items!: Array<{ type: string; label: string; quantity: number; chargePerUnit: number; total: number }>;

  @Column({ name: 'overage_charges', type: 'decimal', precision: 10, scale: 2, default: 0 })
  overage_charges!: number;

  @Column({ name: 'total_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  total_cost!: number;

  @Column({ name: 'customer_charges', type: 'decimal', precision: 10, scale: 2, default: 0 })
  customer_charges!: number;

  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submitted_by!: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submitted_at!: Date;

  @Column({ name: 'dump_tonnage_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dump_tonnage_cost!: number;

  @Column({ name: 'fuel_env_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  fuel_env_cost!: number;

  @Column({ name: 'dump_surcharge_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dump_surcharge_cost!: number;

  @Column({ name: 'customer_tonnage_charge', type: 'decimal', precision: 10, scale: 2, default: 0 })
  customer_tonnage_charge!: number;

  @Column({ name: 'customer_surcharge_charge', type: 'decimal', precision: 10, scale: 2, default: 0 })
  customer_surcharge_charge!: number;

  @Column({ name: 'profit_margin', type: 'decimal', precision: 10, scale: 2, default: 0 })
  profit_margin!: number;

  @Column({ default: 'submitted' })
  status!: string;

  @Column({ default: false })
  invoiced!: boolean;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoice_id!: string;

  @Column({ type: 'jsonb', default: '[]' })
  revisions!: Array<{
    revision: number;
    changedBy: string;
    changedByRole: string;
    changedAt: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    reason?: string;
  }>;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voided_at!: Date;

  @Column({ name: 'voided_by', type: 'uuid', nullable: true })
  voided_by!: string;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  void_reason!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
