import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('notification_preferences')
@Unique(['tenant_id', 'notification_type'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'notification_type', length: 50 })
  notification_type!: string;

  @Column({ name: 'email_enabled', default: true })
  email_enabled!: boolean;

  @Column({ name: 'sms_enabled', default: false })
  sms_enabled!: boolean;

  @Column({ name: 'email_subject_template', nullable: true })
  email_subject_template!: string;

  @Column({ name: 'email_body_template', type: 'text', nullable: true })
  email_body_template!: string;

  @Column({ name: 'sms_template', type: 'text', nullable: true })
  sms_template!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
