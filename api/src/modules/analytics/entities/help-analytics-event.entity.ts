import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('help_analytics_events')
@Index('idx_help_events_tenant', ['tenant_id'])
@Index('idx_help_events_feature', ['feature_id'])
@Index('idx_help_events_name', ['event_name'])
@Index('idx_help_events_created', ['created_at'])
export class HelpAnalyticsEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenant_id!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  user_id!: string | null;

  @Column({ name: 'event_name', length: 100 })
  event_name!: string;

  @Column({ name: 'feature_id', length: 100, nullable: true })
  feature_id!: string | null;

  @Column({ name: 'related_feature_id', length: 100, nullable: true })
  related_feature_id!: string | null;

  @Column({ name: 'page_path', length: 255, nullable: true })
  page_path!: string | null;

  @Column({ name: 'source', length: 50, nullable: true })
  source!: string | null;

  @Column({ name: 'search_query', length: 500, nullable: true })
  search_query!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
