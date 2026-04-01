import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { PricingRule } from './pricing-rule.entity';

@Entity('client_pricing_overrides')
@Index('idx_client_pricing', ['customer_id', 'pricing_rule_id'])
export class ClientPricingOverride {
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

  @Column({ name: 'pricing_rule_id', type: 'uuid', nullable: true })
  pricing_rule_id!: string;

  @ManyToOne(() => PricingRule, { nullable: true })
  @JoinColumn({ name: 'pricing_rule_id' })
  pricing_rule!: PricingRule;

  @Column({ name: 'base_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  base_price!: number;

  @Column({ name: 'weight_allowance_tons', type: 'decimal', precision: 5, scale: 2, nullable: true })
  weight_allowance_tons!: number;

  @Column({ name: 'overage_per_ton', type: 'decimal', precision: 10, scale: 2, nullable: true })
  overage_per_ton!: number;

  @Column({ name: 'daily_overage_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  daily_overage_rate!: number;

  @Column({ name: 'rental_days', type: 'int', nullable: true })
  rental_days!: number;

  @Column({ name: 'effective_from', type: 'date' })
  effective_from!: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effective_to!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
