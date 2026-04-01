import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { TaskChainLink } from './task-chain-link.entity';

@Entity('rental_chains')
@Index('idx_rental_chains_tenant', ['tenant_id'])
@Index('idx_rental_chains_customer', ['customer_id'])
@Index('idx_rental_chains_status', ['tenant_id', 'status'])
export class RentalChain {
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

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  asset_id!: string;

  @ManyToOne(() => Asset, { nullable: true })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;

  @Column({ default: 'active' })
  status!: string;

  @Column({ name: 'drop_off_date', type: 'date' })
  drop_off_date!: string;

  @Column({ name: 'expected_pickup_date', type: 'date', nullable: true })
  expected_pickup_date!: string;

  @Column({ name: 'actual_pickup_date', type: 'date', nullable: true })
  actual_pickup_date!: string;

  @Column({ name: 'pricing_rule_id', type: 'uuid', nullable: true })
  pricing_rule_id!: string;

  @Column({ name: 'dumpster_size', nullable: true })
  dumpster_size!: string;

  @Column({ name: 'rental_days', type: 'int', default: 14 })
  rental_days!: number;

  @OneToMany(() => TaskChainLink, (link) => link.rental_chain, { cascade: true })
  links!: TaskChainLink[];

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
