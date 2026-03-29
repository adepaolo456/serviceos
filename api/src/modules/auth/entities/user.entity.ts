import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'password_hash', select: false })
  password_hash!: string;

  @Column({ name: 'first_name' })
  first_name!: string;

  @Column({ name: 'last_name' })
  last_name!: string;

  @Column({ nullable: true })
  phone!: string;

  @Column({ default: 'viewer' })
  role!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  last_login_at!: Date;

  @Column({ name: 'refresh_token_hash', nullable: true, select: false })
  refresh_token_hash!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
