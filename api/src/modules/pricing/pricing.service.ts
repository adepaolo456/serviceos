import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingTemplate } from './entities/pricing-template.entity';
import { Yard } from '../yards/yard.entity';
import {
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
  ListPricingRulesQueryDto,
  CalculatePriceDto,
} from './dto/pricing.dto';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingRule)
    private pricingRulesRepository: Repository<PricingRule>,
    @InjectRepository(Yard)
    private yardsRepository: Repository<Yard>,
    @InjectRepository(PricingTemplate)
    private templateRepo: Repository<PricingTemplate>,
  ) {}

  async create(
    tenantId: string,
    dto: CreatePricingRuleDto,
  ): Promise<PricingRule> {
    const rule = this.pricingRulesRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      service_type: dto.serviceType,
      asset_subtype: dto.assetSubtype,
      customer_type: dto.customerType,
      base_price: dto.basePrice,
      rental_period_days: dto.rentalPeriodDays ?? 7,
      extra_day_rate: dto.extraDayRate ?? 0,
      included_miles: dto.includedMiles ?? 0,
      per_mile_charge: dto.perMileCharge ?? 0,
      max_service_miles: dto.maxServiceMiles,
      included_tons: dto.includedTons ?? 0,
      overage_per_ton: dto.overagePerTon ?? 0,
      delivery_fee: dto.deliveryFee ?? 0,
      pickup_fee: dto.pickupFee ?? 0,
      exchange_fee: dto.exchangeFee ?? 0,
      require_deposit: dto.requireDeposit ?? false,
      deposit_amount: dto.depositAmount ?? 0,
      tax_rate: dto.taxRate ?? 0,
    });
    return this.pricingRulesRepository.save(rule);
  }

  async findAll(tenantId: string, query: ListPricingRulesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const today = new Date().toISOString().split('T')[0];

    const qb = this.pricingRulesRepository
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.is_active = true')
      .andWhere('(p.effective_until IS NULL OR p.effective_until >= :today)', { today });

    if (query.serviceType) {
      qb.andWhere('p.service_type = :serviceType', {
        serviceType: query.serviceType,
      });
    }

    if (query.assetSubtype) {
      qb.andWhere('p.asset_subtype = :assetSubtype', {
        assetSubtype: query.assetSubtype,
      });
    }

    qb.orderBy('p.service_type', 'ASC')
      .addOrderBy('p.asset_subtype', 'ASC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantId: string, id: string): Promise<PricingRule> {
    const rule = await this.pricingRulesRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!rule) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }
    return rule;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePricingRuleDto,
  ): Promise<PricingRule> {
    const old = await this.findOne(tenantId, id);
    const today = new Date().toISOString().split('T')[0];

    // Archive old version
    old.effective_until = today;
    await this.pricingRulesRepository.save(old);

    // Create new versioned rule
    const newRule = this.pricingRulesRepository.create({
      tenant_id: tenantId,
      name: dto.name ?? old.name,
      service_type: dto.serviceType ?? old.service_type,
      asset_subtype: dto.assetSubtype ?? old.asset_subtype,
      customer_type: dto.customerType ?? old.customer_type,
      base_price: dto.basePrice ?? old.base_price,
      rental_period_days: dto.rentalPeriodDays ?? old.rental_period_days,
      extra_day_rate: dto.extraDayRate ?? old.extra_day_rate,
      included_miles: dto.includedMiles ?? old.included_miles,
      per_mile_charge: dto.perMileCharge ?? old.per_mile_charge,
      max_service_miles: dto.maxServiceMiles ?? old.max_service_miles,
      included_tons: dto.includedTons ?? old.included_tons,
      overage_per_ton: dto.overagePerTon ?? old.overage_per_ton,
      delivery_fee: dto.deliveryFee ?? old.delivery_fee,
      pickup_fee: dto.pickupFee ?? old.pickup_fee,
      exchange_fee: dto.exchangeFee ?? old.exchange_fee,
      require_deposit: dto.requireDeposit ?? old.require_deposit,
      deposit_amount: dto.depositAmount ?? old.deposit_amount,
      tax_rate: dto.taxRate ?? old.tax_rate,
      failed_trip_base_fee: old.failed_trip_base_fee,
      min_rental_days: old.min_rental_days,
      max_rental_days: old.max_rental_days,
      is_active: dto.isActive ?? true,
      effective_date: today,
    } as Partial<PricingRule>);

    return this.pricingRulesRepository.save(newRule);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const rule = await this.findOne(tenantId, id);
    const today = new Date().toISOString().split('T')[0];
    rule.effective_until = today;
    rule.is_active = false;
    await this.pricingRulesRepository.save(rule);
  }

  async calculate(tenantId: string, dto: CalculatePriceDto) {
    const qb = this.pricingRulesRepository
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.is_active = true')
      .andWhere('p.service_type = :serviceType', {
        serviceType: dto.serviceType,
      })
      .andWhere('p.asset_subtype = :assetSubtype', {
        assetSubtype: dto.assetSubtype,
      });

    if (dto.customerType) {
      qb.andWhere(
        '(p.customer_type = :customerType OR p.customer_type IS NULL)',
        { customerType: dto.customerType },
      );
      qb.orderBy(
        `CASE WHEN p.customer_type = '${dto.customerType}' THEN 0 ELSE 1 END`,
        'ASC',
      );
    } else {
      qb.andWhere('p.customer_type IS NULL');
    }

    const rule = await qb.getOne();
    if (!rule) {
      throw new BadRequestException(
        `No active pricing available for ${dto.assetSubtype} dumpsters. This size cannot be quoted or booked at this time.`,
      );
    }

    // Auto-fetch primary yard if no yard coords provided
    let yardLat = dto.yardLat;
    let yardLng = dto.yardLng;
    if (!yardLat || !yardLng) {
      const primaryYard = await this.yardsRepository.findOne({
        where: { tenant_id: tenantId, is_primary: true, is_active: true },
      });
      if (primaryYard?.lat && primaryYard?.lng) {
        yardLat = Number(primaryYard.lat);
        yardLng = Number(primaryYard.lng);
      }
    }

    // Distance-band model replaces legacy per-mile pricing
    const distanceBand = this.calculateDistanceCharge(yardLat, yardLng, dto.customerLat, dto.customerLng);
    const distanceSurcharge = distanceBand.distanceCharge;

    if (
      rule.max_service_miles &&
      distanceBand.distanceMiles > Number(rule.max_service_miles)
    ) {
      throw new BadRequestException(
        `Distance ${distanceBand.distanceMiles.toFixed(1)} miles exceeds max service radius of ${rule.max_service_miles} miles`,
      );
    }

    const rentalDays = dto.rentalDays ?? Number(rule.rental_period_days);
    const includedDays = Number(rule.rental_period_days);
    const extraDays = Math.max(0, rentalDays - includedDays);
    const extraDayCharges = extraDays * Number(rule.extra_day_rate);

    let jobFee = 0;
    let exchangeDiscount = 0;
    if (dto.jobType === 'delivery') {
      jobFee = Number(rule.delivery_fee);
    } else if (dto.jobType === 'pickup') {
      jobFee = Number(rule.pickup_fee);
    } else if (dto.jobType === 'exchange') {
      // Exchange = pickup + new delivery, priced same as delivery
      jobFee = Number(rule.delivery_fee);
      // exchange_fee repurposed as discount %. Old flat fees (>50) are ignored.
      const discountPct = Number(rule.exchange_fee) || 0;
      if (discountPct > 0 && discountPct <= 50) {
        exchangeDiscount = discountPct;
      }
    }

    const basePrice = Number(rule.base_price);
    let subtotal = basePrice + extraDayCharges + distanceSurcharge + jobFee;
    // Apply exchange discount if applicable
    if (exchangeDiscount > 0) {
      subtotal = Math.round(subtotal * (1 - exchangeDiscount / 100) * 100) / 100;
    }
    // Tax is handled at invoice level, not at quoting/booking time.
    // Per-rule tax_rate is informational only; do not bake into quoted total.
    const taxRate = 0;
    const tax = 0;
    const total = Math.round(subtotal * 100) / 100;

    const requireDeposit = rule.require_deposit;
    const depositAmount = requireDeposit ? Number(rule.deposit_amount) : 0;

    return {
      rule: {
        id: rule.id,
        name: rule.name,
      },
      breakdown: {
        basePrice,
        rentalDays,
        includedDays,
        extraDays,
        extraDayRate: Number(rule.extra_day_rate),
        extraDayCharges,
        distanceMiles: distanceBand.distanceMiles,
        includedMiles: 15,
        excessMiles: distanceBand.extraMiles,
        perMileCharge: 25,
        distanceSurcharge: distanceBand.distanceCharge,
        jobType: dto.jobType,
        jobFee,
        subtotal,
        taxRate,
        tax,
        total,
        requireDeposit,
        depositAmount,
        exchangeDiscount,
        isExchange: dto.jobType === 'exchange',
        includedTons: Number(rule.included_tons),
        overagePerTon: Number(rule.overage_per_ton),
      },
    };
  }

  async listTemplates(tenantId: string) {
    return this.templateRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { name: 'ASC' } });
  }

  async createTemplate(tenantId: string, body: Record<string, unknown>) {
    const template = this.templateRepo.create({
      tenant_id: tenantId,
      name: body.name as string,
      discount_percentage: body.discountPercentage != null ? Number(body.discountPercentage) : null,
      exempt_extra_day_charges: !!body.exemptExtraDayCharges,
      custom_pricing: (body.customPricing || body.custom_pricing) as Record<string, unknown> || null,
    } as Partial<PricingTemplate>);
    return this.templateRepo.save(template);
  }

  async updateTemplate(id: string, body: Record<string, unknown>) {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) throw new NotFoundException('Template not found');
    if (body.name !== undefined) template.name = body.name as string;
    if (body.discountPercentage !== undefined) template.discount_percentage = Number(body.discountPercentage);
    if (body.exemptExtraDayCharges !== undefined) template.exempt_extra_day_charges = !!body.exemptExtraDayCharges;
    if (body.customPricing !== undefined) template.custom_pricing = body.customPricing as Record<string, unknown>;
    return this.templateRepo.save(template);
  }

  async deleteTemplate(id: string) {
    await this.templateRepo.update(id, { is_active: false });
    return { message: 'Deleted' };
  }

  /**
   * Distance-band pricing: first 15 miles free, then $25 per 5-mile band (ceiling).
   */
  calculateDistanceCharge(
    yardLat: number | null | undefined,
    yardLng: number | null | undefined,
    customerLat: number,
    customerLng: number,
  ): { distanceMiles: number; extraMiles: number; bands: number; distanceCharge: number } {
    if (!yardLat || !yardLng) {
      throw new BadRequestException('Yard address not geocoded — cannot calculate distance pricing');
    }
    const distanceMiles = this.haversine(customerLat, customerLng, yardLat, yardLng);
    const rounded = Math.round(distanceMiles * 100) / 100;
    const extraMiles = Math.max(rounded - 15, 0);
    const bands = Math.ceil(extraMiles / 5);
    const distanceCharge = bands * 25;
    return { distanceMiles: rounded, extraMiles, bands, distanceCharge };
  }

  private haversine(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 3958.8;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
