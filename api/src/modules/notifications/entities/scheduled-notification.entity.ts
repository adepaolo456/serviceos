import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';

@Entity('scheduled_notifications')
export class ScheduledNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'notification_type', length: 50 })
  notification_type!: string;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoice_id!: string;

  @Column({ name: 'scheduled_for', type: 'timestamptz' })
  scheduled_for!: Date;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processed_at!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
