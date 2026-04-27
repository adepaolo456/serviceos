import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';

@Entity('client_notification_overrides')
@Unique(['customer_id', 'notification_type'])
export class ClientNotificationOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'customer_id', type: 'uuid' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'notification_type', length: 50 })
  notification_type!: string;

  @Column({ name: 'email_enabled', type: 'boolean', nullable: true })
  email_enabled!: boolean | null;

  @Column({ name: 'sms_enabled', type: 'boolean', nullable: true })
  sms_enabled!: boolean | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
