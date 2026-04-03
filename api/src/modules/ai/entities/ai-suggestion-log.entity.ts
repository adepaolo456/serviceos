import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_suggestion_log')
export class AiSuggestionLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'user_id' })
  user_id!: string;

  @Column({ length: 50 })
  section!: string;

  @Column({ name: 'request_context', type: 'jsonb', nullable: true })
  request_context!: Record<string, any> | null;

  @Column({ name: 'response_suggestions', type: 'jsonb', nullable: true })
  response_suggestions!: Record<string, any> | null;

  @Column({ default: false })
  accepted!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
