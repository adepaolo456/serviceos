import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

@Entity('customer_notes')
export class CustomerNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ default: 'manual' })
  type!: string; // manual, system

  @Column({ name: 'author_name', nullable: true })
  author_name!: string;

  @Column({ name: 'author_id', nullable: true })
  author_id!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
