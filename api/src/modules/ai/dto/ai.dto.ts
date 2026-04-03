import { IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const VALID_SECTIONS = [
  'pricing',
  'vehicles',
  'labor_rates',
  'notifications',
  'yards',
  'company_info',
  'portal',
] as const;

export type AiSection = (typeof VALID_SECTIONS)[number];

export class GetSuggestionsDto {
  @ApiProperty({ enum: VALID_SECTIONS })
  @IsString()
  @IsIn(VALID_SECTIONS)
  section!: AiSection;

  @ApiPropertyOptional()
  @IsOptional()
  context?: Record<string, unknown>;
}

export interface Suggestion {
  field: string;
  value: unknown;
  explanation: string;
}

export interface SuggestionResponse {
  suggestions: Suggestion[];
  source: 'static' | 'ai';
}
