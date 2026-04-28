import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('pricing_templates')
export class PricingTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column()
  name!: string;

  @Column({ name: 'discount_percentage', type: 'decimal', precision: 5, scale: 2, nullable: true })
  discount_percentage!: number;

  @Column({ name: 'exempt_extra_day_charges', default: false })
  exempt_extra_day_charges!: boolean;

  @Column({ name: 'custom_pricing', type: 'jsonb', nullable: true })
  custom_pricing!: Record<string, unknown>;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
