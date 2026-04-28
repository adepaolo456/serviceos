import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('yards')
export class Yard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb', nullable: true })
  address!: Record<string, string>;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat!: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng!: number;

  @Column({ name: 'is_primary', default: false })
  is_primary!: boolean;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
