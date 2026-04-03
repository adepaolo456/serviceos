import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const VALID_STEP_KEYS = [
  'company_info',
  'pricing',
  'yards',
  'vehicles',
  'labor_rates',
  'notifications',
  'portal',
] as const;

export type StepKey = (typeof VALID_STEP_KEYS)[number];

export const STEP_ORDER: StepKey[] = [...VALID_STEP_KEYS];

export const STEP_CATEGORIES: Record<StepKey, 'required' | 'recommended' | 'optional'> = {
  company_info: 'required',
  pricing: 'required',
  yards: 'required',
  vehicles: 'recommended',
  labor_rates: 'recommended',
  notifications: 'optional',
  portal: 'optional',
};

export class UpdateChecklistStepDto {
  @ApiProperty({ enum: ['completed', 'skipped'] })
  @IsString()
  @IsIn(['completed', 'skipped'])
  status!: 'completed' | 'skipped';
}

export interface ChecklistItem {
  stepKey: StepKey;
  status: 'pending' | 'completed' | 'skipped' | 'auto_completed';
  completedAt: Date | null;
  completedBy: string | null;
  required: boolean;
  category: 'required' | 'recommended' | 'optional';
}

export interface ProgressResponse {
  total: number;
  completed: number;
  skipped: number;
  percentage: number;
  requiredComplete: boolean;
  steps: ChecklistItem[];
}
