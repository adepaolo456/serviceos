import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { SurchargeTemplate } from './surcharge-template.entity';

@Entity('client_surcharge_overrides')
@Index('idx_client_surcharges', ['customer_id', 'surcharge_template_id'])
export class ClientSurchargeOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'surcharge_template_id' })
  surcharge_template_id!: string;

  @ManyToOne(() => SurchargeTemplate, (t) => t.client_overrides)
  @JoinColumn({ name: 'surcharge_template_id' })
  surcharge_template!: SurchargeTemplate;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ name: 'available_for_billing', default: true })
  available_for_billing!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
