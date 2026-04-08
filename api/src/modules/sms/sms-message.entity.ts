import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('sms_messages')
@Index('idx_sms_messages_tenant', ['tenant_id', 'created_at'])
@Index('idx_sms_messages_customer', ['tenant_id', 'customer_id', 'created_at'])
export class SmsMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customer_id!: string | null;

  @Column({ name: 'quote_id', type: 'uuid', nullable: true })
  quote_id!: string | null;

  @Column({ name: 'direction', length: 10 })
  direction!: 'outbound' | 'inbound';

  @Column({ name: 'from_number', length: 20 })
  from_number!: string;

  @Column({ name: 'to_number', length: 20 })
  to_number!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ length: 20, default: 'twilio' })
  provider!: string;

  @Column({ name: 'provider_message_sid', length: 64, nullable: true })
  provider_message_sid!: string | null;

  @Column({ length: 20, default: 'sent' })
  status!: string;

  @Column({ name: 'source_type', length: 30, nullable: true })
  source_type!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
