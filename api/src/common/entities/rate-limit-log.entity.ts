import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('rate_limit_log')
export class RateLimitLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ip_address', length: 45 })
  ip_address!: string;

  @Column({ length: 100 })
  endpoint!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
