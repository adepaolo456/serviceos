import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

@Entity('tenant_setup_checklist')
@Unique(['tenant_id', 'step_key'])
export class SetupChecklist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'step_key', length: 50 })
  step_key!: string;

  @Column({ length: 20, default: 'pending' })
  status!: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completed_at!: Date | null;

  @Column({ name: 'completed_by', nullable: true })
  completed_by!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
