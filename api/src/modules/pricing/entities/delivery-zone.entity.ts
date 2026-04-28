import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('delivery_zones')
export class DeliveryZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'zone_name' })
  zone_name!: string;

  @Column({ name: 'min_miles', type: 'decimal', precision: 6, scale: 2, default: 0 })
  min_miles!: number;

  @Column({ name: 'max_miles', type: 'decimal', precision: 6, scale: 2, default: 0 })
  max_miles!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  surcharge!: number;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order!: number;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
