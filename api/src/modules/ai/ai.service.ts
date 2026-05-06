import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSuggestionLog } from './entities/ai-suggestion-log.entity';
import {
  AiSection,
  VALID_SECTIONS,
  SuggestionResponse,
} from './dto/ai.dto';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(AiSuggestionLog)
    private logRepo: Repository<AiSuggestionLog>,
  ) {}

  /**
   * arcX (2026-05-06): the static suggestion catalog backing this method
   * was removed. Reasons: (1) materially stale vs. active tenant
   * pricing_rules (10yd suggested at $450 while actual is $650;
   * overage_per_ton at $95 vs $185; sizes 30yd / 40yd missing entirely),
   * (2) implicitly waste/dumpster vertical-locked, violating the
   * multi-vertical scoping rule. Zero usage verified at audit time
   * (ai_suggestion_log empty, rate_limit_log empty for AI endpoints,
   * 7-day Vercel runtime logs empty, zero frontend callers).
   *
   * The endpoint, DTO, entity, and ai_suggestion_log table are preserved
   * as the landing pad for a future tenant-aware AI wiring arc that
   * would consume PricingService.findActiveRule (and similar
   * tenant-aware lookups for non-pricing sections) to populate the
   * suggestions array per tenant. Until then, the response is empty —
   * but the request is still logged so any new caller surfaces.
   */
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

    const response: SuggestionResponse = { suggestions: [], source: 'static' };

    // Preserve the usage signal: log the request even though the response
    // carries no suggestions today. If a new caller appears, the row in
    // ai_suggestion_log surfaces it.
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
