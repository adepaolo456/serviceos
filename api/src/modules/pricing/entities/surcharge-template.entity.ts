import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { ClientSurchargeOverride } from './client-surcharge-override.entity';

@Entity('surcharge_templates')
export class SurchargeTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column()
  name!: string;

  @Column({ name: 'default_amount', type: 'decimal', precision: 10, scale: 2 })
  default_amount!: number;

  @Column({ name: 'is_taxable', default: false })
  is_taxable!: boolean;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @OneToMany(() => ClientSurchargeOverride, (o) => o.surcharge_template)
  client_overrides!: ClientSurchargeOverride[];

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
