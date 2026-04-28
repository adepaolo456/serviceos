import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'user_id' })
  user_id!: string;

  @Column({ name: 'clock_in', type: 'timestamptz' })
  clock_in!: Date;

  @Column({ name: 'clock_out', type: 'timestamptz', nullable: true })
  clock_out!: Date | null;

  @Column({ name: 'clock_in_location', type: 'jsonb', nullable: true })
  clock_in_location!: Record<string, unknown> | null;

  @Column({ name: 'clock_out_location', type: 'jsonb', nullable: true })
  clock_out_location!: Record<string, unknown> | null;

  @Column({ name: 'break_minutes', type: 'int', default: 0 })
  break_minutes!: number;

  @Column({ name: 'total_hours', type: 'decimal', precision: 5, scale: 2, default: 0 })
  total_hours!: number;

  @Column({ default: 'pending' })
  status!: string; // pending, approved, flagged

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ name: 'approved_by', nullable: true })
  approved_by!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
