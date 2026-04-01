import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_revisions')
export class InvoiceRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invoice_id' })
  invoice_id!: string;

  @ManyToOne(() => Invoice, (inv) => inv.revisions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;

  @Column({ name: 'revision_number', type: 'int' })
  revision_number!: number;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, any>;

  @Column({ type: 'jsonb', default: '{}' })
  changes!: Record<string, any>;

  @Column({ name: 'change_summary', type: 'text', nullable: true })
  change_summary!: string;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changed_by!: string;

  @Column({ name: 'changed_at', type: 'timestamptz', default: () => 'NOW()' })
  changed_at!: Date;
}
