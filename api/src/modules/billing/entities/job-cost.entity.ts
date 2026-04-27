import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Job } from '../../jobs/entities/job.entity';
import { Invoice } from './invoice.entity';

@Entity('job_costs')
export class JobCost {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'job_id', type: 'uuid' })
  job_id!: string;

  @ManyToOne(() => Job)
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoice_id!: string;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'cost_type' })
  cost_type!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ name: 'dump_location_id', type: 'uuid', nullable: true })
  dump_location_id!: string;

  @Column({ name: 'dump_ticket_number', nullable: true })
  dump_ticket_number!: string;

  @Column({ name: 'net_weight_tons', type: 'decimal', precision: 6, scale: 2, nullable: true })
  net_weight_tons!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
