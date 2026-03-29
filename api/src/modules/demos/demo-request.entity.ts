import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('demo_requests')
export class DemoRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column({ nullable: true })
  phone!: string;

  @Column({ name: 'company_name' })
  company_name!: string;

  @Column({ name: 'business_type', nullable: true })
  business_type!: string;

  @Column({ name: 'fleet_size', nullable: true })
  fleet_size!: string;

  @Column({ type: 'text', nullable: true })
  message!: string;

  @Column({ default: 'new' })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
