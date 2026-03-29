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
import { User } from '../../auth/entities/user.entity';

@Entity('routes')
export class Route {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'driver_id' })
  driver_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driver_id' })
  driver!: User;

  @Column({ name: 'route_date', type: 'date' })
  route_date!: string;

  @Column({ default: 'planned' })
  status!: string;

  @Column({ name: 'start_location', type: 'jsonb', nullable: true })
  start_location!: Record<string, any>;

  @Column({ name: 'total_stops', type: 'int', default: 0 })
  total_stops!: number;

  @Column({
    name: 'total_distance_miles',
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  total_distance_miles!: number;

  @Column({ name: 'estimated_duration_min', type: 'int', nullable: true })
  estimated_duration_min!: number;

  @Column({ name: 'actual_start_time', type: 'timestamptz', nullable: true })
  actual_start_time!: Date;

  @Column({ name: 'actual_end_time', type: 'timestamptz', nullable: true })
  actual_end_time!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
