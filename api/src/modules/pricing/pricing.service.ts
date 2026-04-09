import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingTemplate } from './entities/pricing-template.entity';
import { TenantFee } from './entities/tenant-fee.entity';
import { PricingSnapshot } from './entities/pricing-snapshot.entity';
import { ClientPricingOverride } from './entities/client-pricing-override.entity';
import { Yard } from '../yards/yard.entity';
import {
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
  ListPricingRulesQueryDto,
  CalculatePriceDto,
} from './dto/pricing.dto';
import { isValidCoordinatePair } from '../../common/helpers/coordinate-validator';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingRule)
    private pricingRulesRepository: Repository<PricingRule>,
    @InjectRepository(Yard)
    private yardsRepository: Repository<Yard>,
    @InjectRepository(PricingTemplate)
    private templateRepo: Repository<PricingTemplate>,
    @InjectRepository(TenantFee)
    private tenantFeeRepo: Repository<TenantFee>,
    @InjectRepository(PricingSnapshot)
    private snapshotRepo: Repository<PricingSnapshot>,
    @InjectRepository(ClientPricingOverride)
    private clientPricingRepo: Repository<ClientPricingOverride>,
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
      .where('p.tenant_id = :tenantId', { tenantId });

    if (!query.include_history) {
      qb.andWhere('p.is_active = true')
        .andWhere('(p.effective_until IS NULL OR p.effective_until >= :today)', { today });
    }

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

    // Create new versioned rule (immutable — old row is never mutated for pricing fields)
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
      residential_included_days: old.residential_included_days,
      commercial_included_days: old.commercial_included_days,
      residential_extra_day_rate: old.residential_extra_day_rate,
      commercial_extra_day_rate: old.commercial_extra_day_rate,
      commercial_unlimited_days: old.commercial_unlimited_days,
      is_active: dto.isActive ?? true,
      effective_date: today,
      published_at: new Date(),
    } as Partial<PricingRule>);

    const saved = await this.pricingRulesRepository.save(newRule);

    // Archive old version: mark superseded, deactivate
    old.effective_until = today;
    old.is_active = false;
    old.superseded_by = saved.id;
    await this.pricingRulesRepository.save(old);

    return saved;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const rule = await this.findOne(tenantId, id);
    const today = new Date().toISOString().split('T')[0];
    rule.effective_until = today;
    rule.is_active = false;
    await this.pricingRulesRepository.save(rule);
  }

  async calculate(tenantId: string, dto: CalculatePriceDto) {
    const rule = await this.findActiveRule(tenantId, dto.serviceType, dto.assetSubtype, dto.customerType);

    // ── Step 5: Multi-yard support ──
    // If yardId provided, load that yard's coordinates. Otherwise fall back to yardLat/Lng or primary yard.
    let yardLat = dto.yardLat;
    let yardLng = dto.yardLng;
    let yardId: string | undefined = dto.yardId;

    if (dto.yardId) {
      const yard = await this.yardsRepository.findOne({
        where: { id: dto.yardId, tenant_id: tenantId, is_active: true },
      });
      if (yard?.lat && yard?.lng) {
        yardLat = Number(yard.lat);
        yardLng = Number(yard.lng);
        yardId = yard.id;
      }
    }

    if (!yardLat || !yardLng) {
      const primaryYard = await this.yardsRepository.findOne({
        where: { tenant_id: tenantId, is_primary: true, is_active: true },
      });
      if (primaryYard?.lat && primaryYard?.lng) {
        yardLat = Number(primaryYard.lat);
        yardLng = Number(primaryYard.lng);
        yardId = primaryYard.id;
      }
    }

    // Validate coordinates before distance calculation
    const customerCoordsValid = isValidCoordinatePair(dto.customerLat, dto.customerLng);
    const yardCoordsValid = isValidCoordinatePair(yardLat, yardLng);
    const geocodeStatus = customerCoordsValid ? 'existing_coordinates' : 'invalid';
    const coordinateSource = customerCoordsValid ? 'stored' : 'missing';

    // Distance-band model
    const distanceBand = this.calculateDistanceCharge(yardLat, yardLng, dto.customerLat, dto.customerLng);

    if (rule.max_service_miles && distanceBand.distanceMiles > Number(rule.max_service_miles)) {
      throw new BadRequestException(
        `Distance ${distanceBand.distanceMiles.toFixed(1)} miles exceeds max service radius of ${rule.max_service_miles} miles`,
      );
    }

    // ── Step 6: Commercial vs residential rental policies ──
    const rentalType = dto.rentalType || 'residential';
    let includedDays: number;
    let extraDayRate: number;
    let unlimitedDays = false;

    if (rentalType === 'commercial') {
      includedDays = rule.commercial_included_days ?? Number(rule.rental_period_days);
      extraDayRate = rule.commercial_extra_day_rate != null ? Number(rule.commercial_extra_day_rate) : Number(rule.extra_day_rate);
      unlimitedDays = !!rule.commercial_unlimited_days;
    } else {
      includedDays = rule.residential_included_days ?? Number(rule.rental_period_days);
      extraDayRate = rule.residential_extra_day_rate != null ? Number(rule.residential_extra_day_rate) : Number(rule.extra_day_rate);
    }

    const rentalDays = dto.rentalDays ?? includedDays;
    const extraDays = unlimitedDays ? 0 : Math.max(0, rentalDays - includedDays);
    const extraDayCharges = extraDays * extraDayRate;

    // ── Job fee + exchange discount ──
    let jobFee = 0;
    let exchangeDiscount = 0;
    if (dto.jobType === 'delivery') {
      jobFee = Number(rule.delivery_fee);
    } else if (dto.jobType === 'pickup') {
      jobFee = Number(rule.pickup_fee);
    } else if (dto.jobType === 'exchange') {
      jobFee = Number(rule.delivery_fee);
      const discountPct = Number(rule.exchange_fee) || 0;
      if (discountPct > 0 && discountPct <= 50) {
        exchangeDiscount = discountPct;
      }
    }

    // ── Step 3: Exchange tonnage logic ──
    // Business rule: for exchange jobs, tonnage overage is calculated based ONLY
    // on the pickup container. The dumpster being hauled to the dump determines
    // the disposal allowance, not the new dropoff container.
    let includedTons = Number(rule.included_tons);
    let overagePerTon = Number(rule.overage_per_ton);
    let tonnageSource: string | undefined;
    let exchangePickupSubtype: string | undefined;
    let exchangeDropoffSubtype: string | undefined;

    if (dto.jobType === 'exchange' && dto.exchange_context) {
      exchangePickupSubtype = dto.exchange_context.pickup_asset_subtype;
      exchangeDropoffSubtype = dto.exchange_context.dropoff_asset_subtype;
      tonnageSource = 'pickup';

      // Load the pickup container's pricing rule for tonnage allowance
      const pickupRule = await this.findActiveRule(
        tenantId, dto.serviceType, dto.exchange_context.pickup_asset_subtype, dto.customerType,
      ).catch(() => null);

      if (pickupRule) {
        includedTons = Number(pickupRule.included_tons);
        overagePerTon = Number(pickupRule.overage_per_ton);
      }
    }

    // ── Client pricing override (Pass 1 scope: base_price only) ──
    // When a customer is specified AND has an active base_price override for
    // this rule, use the override. Every other field (weight allowance,
    // overage, distance, extra-day rate, fees, deposit, commercial/residential
    // policies) continues to use the global rule exactly as before.
    // Scoped by tenant_id + customer_id — no cross-tenant leakage possible.
    let basePrice = Number(rule.base_price);
    if (dto.customerId) {
      const today = new Date().toISOString().split('T')[0];
      const override = await this.clientPricingRepo
        .createQueryBuilder('o')
        .where('o.tenant_id = :tenantId', { tenantId })
        .andWhere('o.customer_id = :customerId', { customerId: dto.customerId })
        .andWhere('o.pricing_rule_id = :ruleId', { ruleId: rule.id })
        .andWhere('o.effective_from <= :today', { today })
        .andWhere('(o.effective_to IS NULL OR o.effective_to >= :today)', { today })
        .getOne();
      if (override?.base_price != null) {
        basePrice = Number(override.base_price);
      }
    }
    let subtotal = basePrice + extraDayCharges + distanceBand.distanceCharge + jobFee;

    if (exchangeDiscount > 0) {
      subtotal = Math.round(subtotal * (1 - exchangeDiscount / 100) * 100) / 100;
    }

    // ── Step 7: Tenant fees ──
    const activeFees = await this.tenantFeeRepo.find({
      where: { tenant_id: tenantId, is_active: true },
    });
    const applicableFees = activeFees.filter(
      f => f.applies_to === 'all' || f.applies_to === dto.jobType,
    );
    const fees = applicableFees.map(f => {
      const feeAmount = f.is_percentage
        ? Math.round(subtotal * (Number(f.amount) / 100) * 100) / 100
        : Number(f.amount);
      return { fee_key: f.fee_key, label: f.label, amount: feeAmount, is_percentage: f.is_percentage };
    });
    const totalFees = fees.reduce((sum, f) => sum + f.amount, 0);

    // Tax is handled at invoice level, not at quoting/booking time.
    const taxRate = 0;
    const tax = 0;
    const total = Math.round((subtotal + totalFees) * 100) / 100;

    const requireDeposit = rule.require_deposit;
    const depositAmount = requireDeposit ? Number(rule.deposit_amount) : 0;

    const result = {
      rule: { id: rule.id, name: rule.name },
      breakdown: {
        basePrice,
        rentalDays,
        rentalType,
        includedDays,
        extraDays,
        extraDayRate,
        extraDayCharges,
        unlimitedDays,
        distanceMiles: distanceBand.distanceMiles,
        includedMiles: 15,
        excessMiles: distanceBand.extraMiles,
        perMileCharge: 25,
        distanceSurcharge: distanceBand.distanceCharge,
        jobType: dto.jobType,
        jobFee,
        subtotal,
        fees,
        totalFees,
        taxRate,
        tax,
        total,
        requireDeposit,
        depositAmount,
        exchangeDiscount,
        isExchange: dto.jobType === 'exchange',
        includedTons,
        overagePerTon,
        // Exchange-specific (additive, backward compatible)
        ...(tonnageSource && {
          tonnageSource,
          exchangePickupSubtype,
          exchangeDropoffSubtype,
        }),
        // Metadata
        yardId,
        pricingConfigVersionId: rule.version_id,
        engineVersion: 'v2',
        // Geocode audit (additive)
        geocode_status: geocodeStatus,
        coordinate_source: coordinateSource,
        has_valid_coordinates: customerCoordsValid && yardCoordsValid,
      },
    };

    // ── Step 8: Snapshot persistence ──
    if (dto.persist_snapshot) {
      const snapshot = this.snapshotRepo.create({
        tenant_id: tenantId,
        job_id: dto.jobId || null,
        request_inputs: dto as unknown as Record<string, unknown>,
        pricing_outputs: result as unknown as Record<string, unknown>,
        pricing_config_version_id: rule.version_id || rule.id,
        engine_version: 'v2',
        locked: true,
      });
      const saved = await this.snapshotRepo.save(snapshot);
      return { ...result, snapshot_id: saved.id };
    }

    return result;
  }

  /**
   * Find the best matching active pricing rule for a given service type + subtype + optional customer type.
   * Reusable for both primary and exchange-context lookups.
   */
  private async findActiveRule(
    tenantId: string,
    serviceType: string,
    assetSubtype: string,
    customerType?: string,
  ): Promise<PricingRule> {
    const qb = this.pricingRulesRepository
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.is_active = true')
      .andWhere('p.service_type = :serviceType', { serviceType })
      .andWhere('p.asset_subtype = :assetSubtype', { assetSubtype });

    if (customerType) {
      qb.andWhere('(p.customer_type = :customerType OR p.customer_type IS NULL)', { customerType });
      qb.orderBy(`CASE WHEN p.customer_type = '${customerType}' THEN 0 ELSE 1 END`, 'ASC');
    } else {
      qb.andWhere('p.customer_type IS NULL');
    }

    const rule = await qb.getOne();
    if (!rule) {
      throw new BadRequestException(
        `No active pricing available for ${assetSubtype} dumpsters. This size cannot be quoted or booked at this time.`,
      );
    }
    return rule;
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

  async updateTemplate(tenantId: string, id: string, body: Record<string, unknown>) {
    const template = await this.templateRepo.findOneBy({ id, tenant_id: tenantId });
    if (!template) throw new NotFoundException('Template not found');
    if (body.name !== undefined) template.name = body.name as string;
    if (body.discountPercentage !== undefined) template.discount_percentage = Number(body.discountPercentage);
    if (body.exemptExtraDayCharges !== undefined) template.exempt_extra_day_charges = !!body.exemptExtraDayCharges;
    if (body.customPricing !== undefined) template.custom_pricing = body.customPricing as Record<string, unknown>;
    return this.templateRepo.save(template);
  }

  async deleteTemplate(tenantId: string, id: string) {
    const template = await this.templateRepo.findOneBy({ id, tenant_id: tenantId });
    if (!template) throw new NotFoundException('Template not found');
    template.is_active = false;
    await this.templateRepo.save(template);
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
    if (!isValidCoordinatePair(yardLat, yardLng)) {
      throw new BadRequestException('Yard address not geocoded or has invalid coordinates — cannot calculate distance pricing');
    }
    if (!isValidCoordinatePair(customerLat, customerLng)) {
      throw new BadRequestException('Customer address not geocoded or has invalid coordinates (0,0 is not valid) — cannot calculate distance pricing');
    }
    const distanceMiles = this.haversine(customerLat, customerLng, yardLat!, yardLng!);
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
