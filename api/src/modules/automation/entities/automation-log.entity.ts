import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('automation_logs')
export class AutomationLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'job_id', nullable: true })
  job_id!: string;

  @Column()
  type!: string;

  @Column()
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
