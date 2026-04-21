import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';

@Index('idx_customer_notes_tenant_customer_created',
  ['tenant_id', 'customer_id', 'created_at'])
@Entity('customer_notes')
export class CustomerNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @Column({ name: 'customer_id', type: 'uuid' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer;

  @Column({ type: 'text' })
  content!: string;

  @Column({ default: 'manual' })
  type!: string; // manual, system

  @Column({ name: 'author_name', nullable: true })
  author_name!: string;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  author_id!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
