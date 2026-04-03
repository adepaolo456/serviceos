import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSuggestionLog } from './entities/ai-suggestion-log.entity';
import {
  AiSection,
  VALID_SECTIONS,
  Suggestion,
  SuggestionResponse,
} from './dto/ai.dto';

const STATIC_SUGGESTIONS: Record<AiSection, Suggestion[]> = {
  pricing: [
    { field: 'base_price_10yd', value: 450, explanation: 'Industry average for 10yd dumpster in Northeast US' },
    { field: 'base_price_15yd', value: 550, explanation: 'Industry average for 15yd' },
    { field: 'base_price_20yd', value: 650, explanation: 'Industry average for 20yd' },
    { field: 'overage_rate_per_ton', value: 95, explanation: 'Per ton overage charge, typical range $75-125' },
    { field: 'extra_day_rate', value: 10, explanation: 'Per day beyond rental period' },
    { field: 'rental_period_days', value: 14, explanation: 'Standard 14-day rental period' },
  ],
  vehicles: [
    { field: 'fuel_cost_per_mile', value: 0.65, explanation: 'Average for roll-off trucks in 2026' },
    { field: 'maintenance_per_mile', value: 0.15, explanation: 'Estimated maintenance allocation' },
  ],
  labor_rates: [
    { field: 'driver_hourly_rate', value: 28, explanation: 'Average CDL driver rate in Massachusetts' },
    { field: 'helper_hourly_rate', value: 18, explanation: 'Average helper/laborer rate' },
  ],
  notifications: [
    { field: 'sms_enabled', value: true, explanation: 'SMS improves delivery confirmation rates significantly' },
    { field: 'email_enabled', value: true, explanation: 'Email recommended for invoices and receipts' },
  ],
  yards: [
    { field: 'name', value: 'Main Yard', explanation: 'Primary operating yard' },
  ],
  company_info: [
    { field: 'brand_color', value: '#22C55E', explanation: 'Default ServiceOS green' },
  ],
  portal: [
    { field: 'portal_enabled', value: true, explanation: 'Customer portal lets customers view invoices and make payments' },
  ],
};

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(AiSuggestionLog)
    private logRepo: Repository<AiSuggestionLog>,
  ) {}

  async getSetupSuggestions(
    section: string,
    tenantId: string,
    userId: string,
    context?: Record<string, unknown>,
  ): Promise<SuggestionResponse> {
    if (!VALID_SECTIONS.includes(section as AiSection)) {
      throw new BadRequestException(
        `Invalid section. Must be one of: ${VALID_SECTIONS.join(', ')}`,
      );
    }

    const suggestions = STATIC_SUGGESTIONS[section as AiSection] || [];
    const response: SuggestionResponse = { suggestions, source: 'static' };

    // Log the request
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        user_id: userId,
        section,
        request_context: context || null,
        response_suggestions: response as any,
        accepted: false,
      }),
    );

    return response;
  }
}
