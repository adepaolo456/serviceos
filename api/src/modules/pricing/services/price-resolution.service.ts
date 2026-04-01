import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, IsNull, Or } from 'typeorm';
import { PricingRule } from '../entities/pricing-rule.entity';
import { ClientPricingOverride } from '../entities/client-pricing-override.entity';
import { SurchargeTemplate } from '../entities/surcharge-template.entity';
import { ClientSurchargeOverride } from '../entities/client-surcharge-override.entity';

export interface ResolvedPrice {
  base_price: number;
  weight_allowance_tons: number;
  overage_per_ton: number;
  daily_overage_rate: number;
  rental_days: number;
  tier_used: 'global' | 'client';
  pricing_rule_id: string;
  override_id?: string;
}

@Injectable()
export class PriceResolutionService {
  constructor(
    @InjectRepository(PricingRule)
    private pricingRuleRepo: Repository<PricingRule>,
    @InjectRepository(ClientPricingOverride)
    private clientPricingRepo: Repository<ClientPricingOverride>,
    @InjectRepository(SurchargeTemplate)
    private surchargeTemplateRepo: Repository<SurchargeTemplate>,
    @InjectRepository(ClientSurchargeOverride)
    private clientSurchargeRepo: Repository<ClientSurchargeOverride>,
  ) {}

  async resolvePrice(
    tenantId: string,
    customerId: string,
    dumpsterSize: string,
  ): Promise<ResolvedPrice | null> {
    // 1. Find global pricing rule for this size + tenant
    const rule = await this.pricingRuleRepo.findOne({
      where: {
        tenant_id: tenantId,
        asset_subtype: dumpsterSize,
        is_active: true,
      },
    });

    if (!rule) return null;

    const today = new Date().toISOString().split('T')[0];

    // 2. Check for client pricing override
    const override = await this.clientPricingRepo
      .createQueryBuilder('o')
      .where('o.customer_id = :customerId', { customerId })
      .andWhere('o.pricing_rule_id = :ruleId', { ruleId: rule.id })
      .andWhere('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.effective_from <= :today', { today })
      .andWhere('(o.effective_to IS NULL OR o.effective_to >= :today)', { today })
      .getOne();

    // 3. Merge: client override wins if non-null
    const basePrice = override?.base_price != null ? Number(override.base_price) : Number(rule.base_price);
    const weightAllowance = override?.weight_allowance_tons != null ? Number(override.weight_allowance_tons) : Number(rule.included_tons);
    const overagePerTon = override?.overage_per_ton != null ? Number(override.overage_per_ton) : Number(rule.overage_per_ton);
    const dailyOverageRate = override?.daily_overage_rate != null ? Number(override.daily_overage_rate) : Number(rule.extra_day_rate);
    const rentalDays = override?.rental_days != null ? override.rental_days : rule.rental_period_days;

    return {
      base_price: basePrice,
      weight_allowance_tons: weightAllowance,
      overage_per_ton: overagePerTon,
      daily_overage_rate: dailyOverageRate,
      rental_days: rentalDays,
      tier_used: override ? 'client' : 'global',
      pricing_rule_id: rule.id,
      override_id: override?.id,
    };
  }

  async resolveSurchargeAmount(
    tenantId: string,
    customerId: string,
    surchargeTemplateId: string,
  ): Promise<number> {
    const template = await this.surchargeTemplateRepo.findOne({
      where: { id: surchargeTemplateId, tenant_id: tenantId },
    });

    if (!template) return 0;

    const override = await this.clientSurchargeRepo.findOne({
      where: {
        customer_id: customerId,
        surcharge_template_id: surchargeTemplateId,
        tenant_id: tenantId,
      },
    });

    if (override && override.available_for_billing) {
      return Number(override.amount);
    }

    return Number(template.default_amount);
  }
}
