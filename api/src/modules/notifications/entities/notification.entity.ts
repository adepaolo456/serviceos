import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Job } from '../../jobs/entities/job.entity';
import { Customer } from '../../customers/entities/customer.entity';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customer_id!: string;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column()
  channel!: string;

  @Column()
  type!: string;

  @Column()
  recipient!: string;

  @Column({ nullable: true })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ default: 'queued' })
  status!: string;

  @Column({ name: 'external_id', nullable: true })
  external_id!: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sent_at!: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  error_message!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
