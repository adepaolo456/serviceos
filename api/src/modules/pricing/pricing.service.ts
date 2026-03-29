import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
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

    const qb = this.pricingRulesRepository
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId });

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
    const rule = await this.findOne(tenantId, id);

    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.serviceType !== undefined) rule.service_type = dto.serviceType;
    if (dto.assetSubtype !== undefined) rule.asset_subtype = dto.assetSubtype;
    if (dto.customerType !== undefined) rule.customer_type = dto.customerType;
    if (dto.basePrice !== undefined) rule.base_price = dto.basePrice;
    if (dto.rentalPeriodDays !== undefined)
      rule.rental_period_days = dto.rentalPeriodDays;
    if (dto.extraDayRate !== undefined) rule.extra_day_rate = dto.extraDayRate;
    if (dto.includedMiles !== undefined)
      rule.included_miles = dto.includedMiles;
    if (dto.perMileCharge !== undefined)
      rule.per_mile_charge = dto.perMileCharge;
    if (dto.maxServiceMiles !== undefined)
      rule.max_service_miles = dto.maxServiceMiles;
    if (dto.includedTons !== undefined) rule.included_tons = dto.includedTons;
    if (dto.overagePerTon !== undefined)
      rule.overage_per_ton = dto.overagePerTon;
    if (dto.deliveryFee !== undefined) rule.delivery_fee = dto.deliveryFee;
    if (dto.pickupFee !== undefined) rule.pickup_fee = dto.pickupFee;
    if (dto.exchangeFee !== undefined) rule.exchange_fee = dto.exchangeFee;
    if (dto.requireDeposit !== undefined)
      rule.require_deposit = dto.requireDeposit;
    if (dto.depositAmount !== undefined)
      rule.deposit_amount = dto.depositAmount;
    if (dto.taxRate !== undefined) rule.tax_rate = dto.taxRate;
    if (dto.isActive !== undefined) rule.is_active = dto.isActive;

    return this.pricingRulesRepository.save(rule);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const rule = await this.findOne(tenantId, id);
    await this.pricingRulesRepository.remove(rule);
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
        `No active pricing rule found for ${dto.serviceType} / ${dto.assetSubtype}`,
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

    const distanceMiles = this.haversine(
      dto.customerLat,
      dto.customerLng,
      yardLat,
      yardLng,
    );

    if (
      rule.max_service_miles &&
      distanceMiles > Number(rule.max_service_miles)
    ) {
      throw new BadRequestException(
        `Distance ${distanceMiles.toFixed(1)} miles exceeds max service radius of ${rule.max_service_miles} miles`,
      );
    }

    const rentalDays = dto.rentalDays ?? Number(rule.rental_period_days);
    const includedDays = Number(rule.rental_period_days);
    const extraDays = Math.max(0, rentalDays - includedDays);
    const extraDayCharges = extraDays * Number(rule.extra_day_rate);

    const includedMiles = Number(rule.included_miles);
    const excessMiles = Math.max(0, distanceMiles - includedMiles);
    const distanceSurcharge =
      Math.round(excessMiles * Number(rule.per_mile_charge) * 100) / 100;

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
    const taxRate = Number(rule.tax_rate);
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

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
        distanceMiles: Math.round(distanceMiles * 100) / 100,
        includedMiles,
        excessMiles: Math.round(excessMiles * 100) / 100,
        perMileCharge: Number(rule.per_mile_charge),
        distanceSurcharge,
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
