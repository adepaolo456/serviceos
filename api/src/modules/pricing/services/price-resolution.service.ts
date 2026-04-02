import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from '../entities/pricing-rule.entity';
import { ClientPricingOverride } from '../entities/client-pricing-override.entity';
import { SurchargeTemplate } from '../entities/surcharge-template.entity';
import { ClientSurchargeOverride } from '../entities/client-surcharge-override.entity';
import { TermsTemplate } from '../entities/terms-template.entity';
import { DeliveryZone } from '../entities/delivery-zone.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { MapboxService } from '../../mapbox/mapbox.service';

export interface DeliveryZoneInfo {
  zone_name: string;
  distance_miles: number;
  duration_minutes: number;
  surcharge: number;
  outside_service_area: boolean;
}

export interface ResolvedPrice {
  base_price: number;
  weight_allowance_tons: number;
  overage_per_ton: number;
  daily_overage_rate: number;
  rental_days: number;
  tier_used: 'global' | 'client';
  pricing_rule_id: string;
  override_id: string | null;
  delivery_zone?: DeliveryZoneInfo;
}

export interface ResolvedSurcharge {
  amount: number;
  source: 'global' | 'client';
  is_taxable: boolean;
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
    @InjectRepository(TermsTemplate)
    private termsTemplateRepo: Repository<TermsTemplate>,
    @InjectRepository(DeliveryZone)
    private deliveryZoneRepo: Repository<DeliveryZone>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private mapbox: MapboxService,
  ) {}

  /**
   * 3-tier price resolution: global pricing rule → client override → merged result.
   */
  async resolvePrice(
    tenantId: string,
    customerId: string,
    dumpsterSize: string,
  ): Promise<ResolvedPrice> {
    // 1. Find global pricing rule for this size + tenant
    const rule = await this.pricingRuleRepo.findOne({
      where: {
        tenant_id: tenantId,
        asset_subtype: dumpsterSize,
        is_active: true,
      },
    });

    if (!rule) {
      throw new NotFoundException(
        `No pricing rule found for size ${dumpsterSize}`,
      );
    }

    const today = new Date().toISOString().split('T')[0];

    // 2. Check for client pricing override
    const override = await this.clientPricingRepo
      .createQueryBuilder('o')
      .where('o.customer_id = :customerId', { customerId })
      .andWhere('o.pricing_rule_id = :ruleId', { ruleId: rule.id })
      .andWhere('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.effective_from <= :today', { today })
      .andWhere('(o.effective_to IS NULL OR o.effective_to >= :today)', {
        today,
      })
      .getOne();

    // 3. Merge: client override wins if non-null
    const basePrice =
      override?.base_price != null
        ? Number(override.base_price)
        : Number(rule.base_price);
    const weightAllowance =
      override?.weight_allowance_tons != null
        ? Number(override.weight_allowance_tons)
        : Number(rule.included_tons);
    const overagePerTon =
      override?.overage_per_ton != null
        ? Number(override.overage_per_ton)
        : Number(rule.overage_per_ton);
    const dailyOverageRate =
      override?.daily_overage_rate != null
        ? Number(override.daily_overage_rate)
        : Number(rule.extra_day_rate);
    const rentalDays =
      override?.rental_days != null
        ? override.rental_days
        : rule.rental_period_days;

    return {
      base_price: basePrice,
      weight_allowance_tons: weightAllowance,
      overage_per_ton: overagePerTon,
      daily_overage_rate: dailyOverageRate,
      rental_days: rentalDays,
      tier_used: override ? 'client' : 'global',
      pricing_rule_id: rule.id,
      override_id: override?.id || null,
    };
  }

  /**
   * Resolve the surcharge amount for a customer + template, falling back to
   * the template default when no client override exists.
   */
  async resolveSurchargeAmount(
    tenantId: string,
    customerId: string,
    surchargeTemplateId: string,
  ): Promise<ResolvedSurcharge> {
    const template = await this.surchargeTemplateRepo.findOne({
      where: { id: surchargeTemplateId, tenant_id: tenantId },
    });

    if (!template) {
      throw new NotFoundException(
        `Surcharge template ${surchargeTemplateId} not found`,
      );
    }

    const override = await this.clientSurchargeRepo.findOne({
      where: {
        customer_id: customerId,
        surcharge_template_id: surchargeTemplateId,
        tenant_id: tenantId,
        available_for_billing: true,
      },
    });

    return {
      amount: override ? Number(override.amount) : Number(template.default_amount),
      source: override ? 'client' : 'global',
      is_taxable: template.is_taxable,
    };
  }

  /**
   * Render a terms template by replacing {{placeholders}} with pricing data.
   */
  async renderTermsTemplate(
    templateId: string,
    pricingData: Record<string, any>,
  ): Promise<string> {
    const template = await this.termsTemplateRepo.findOne({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundException(`Terms template ${templateId} not found`);
    }

    let text = template.template_body;

    // Replace all known placeholders
    const replacements: Record<string, string> = {
      weight_allowance: String(pricingData.weight_allowance_tons ?? ''),
      weight_allowance_tons: String(pricingData.weight_allowance_tons ?? ''),
      overage_per_ton: String(pricingData.overage_per_ton ?? ''),
      daily_rate: String(pricingData.daily_overage_rate ?? ''),
      daily_overage_rate: String(pricingData.daily_overage_rate ?? ''),
      rental_days: String(pricingData.rental_days ?? ''),
      base_price: String(pricingData.base_price ?? ''),
    };

    for (const [key, value] of Object.entries(replacements)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // Replace any remaining {{key}} placeholders from pricingData
    for (const [key, value] of Object.entries(pricingData)) {
      text = text.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
        String(value ?? ''),
      );
    }

    return text;
  }

  /**
   * Resolve delivery zone surcharge based on driving distance from yard.
   */
  // Legacy — no longer used for pricing. Distance-band model in PricingService.calculateDistanceCharge() replaces this.
  async resolveDeliveryZone(
    tenantId: string,
    customerLat?: number | null,
    customerLng?: number | null,
    customerAddress?: string,
  ): Promise<DeliveryZoneInfo | null> {
    // Get yard coordinates
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.yard_latitude || !tenant?.yard_longitude) return null;

    const yardLat = Number(tenant.yard_latitude);
    const yardLng = Number(tenant.yard_longitude);

    // Get customer coordinates — geocode if needed
    let destLat = customerLat ? Number(customerLat) : null;
    let destLng = customerLng ? Number(customerLng) : null;

    if ((!destLat || !destLng) && customerAddress) {
      const geo = await this.mapbox.geocodeAddress(customerAddress);
      if (geo) {
        destLat = geo.lat;
        destLng = geo.lng;
      }
    }

    if (!destLat || !destLng) return null;

    // Calculate drive distance (with haversine fallback)
    const drive = await this.mapbox.calculateDriveDistance(
      yardLat,
      yardLng,
      destLat,
      destLng,
    );
    if (!drive) return null;

    // Match to delivery zone
    const zones = await this.deliveryZoneRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC' },
    });

    let matched: DeliveryZone | null = null;
    let maxMiles = 0;
    for (const z of zones) {
      const min = Number(z.min_miles);
      const max = Number(z.max_miles);
      if (max > maxMiles) maxMiles = max;
      if (drive.distance_miles >= min && drive.distance_miles < max) {
        matched = z;
      }
    }

    return {
      zone_name: matched?.zone_name || 'Outside Service Area',
      distance_miles: drive.distance_miles,
      duration_minutes: drive.duration_minutes,
      surcharge: matched ? Number(matched.surcharge) : 0,
      outside_service_area: !matched && drive.distance_miles > maxMiles,
    };
  }
}
