import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RentalChain } from './rental-chain.entity';
import { Job } from '../../jobs/entities/job.entity';
import { Invoice } from '../../billing/entities/invoice.entity';

@Entity('task_chain_links')
@Index('idx_chain_links_chain', ['rental_chain_id', 'sequence_number'])
@Index('idx_chain_links_job', ['job_id'])
export class TaskChainLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'rental_chain_id' })
  rental_chain_id!: string;

  @ManyToOne(() => RentalChain, (chain) => chain.links, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rental_chain_id' })
  rental_chain!: RentalChain;

  @Column({ name: 'job_id' })
  job_id!: string;

  @ManyToOne(() => Job)
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'sequence_number', type: 'int' })
  sequence_number!: number;

  @Column({ name: 'task_type' })
  task_type!: string;

  @Column({ default: 'scheduled' })
  status!: string;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoice_id!: string;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'previous_link_id', type: 'uuid', nullable: true })
  previous_link_id!: string;

  @ManyToOne(() => TaskChainLink, { nullable: true })
  @JoinColumn({ name: 'previous_link_id' })
  previous_link!: TaskChainLink;

  @Column({ name: 'next_link_id', type: 'uuid', nullable: true })
  next_link_id!: string;

  @ManyToOne(() => TaskChainLink, { nullable: true })
  @JoinColumn({ name: 'next_link_id' })
  next_link!: TaskChainLink;

  @Column({ name: 'scheduled_date', type: 'date' })
  scheduled_date!: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completed_at!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
