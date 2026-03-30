import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { Customer } from '../customers/entities/customer.entity';

export interface PriceCalculation {
  basePrice: number;
  deliveryFee: number;
  radiusSurcharge: number;
  subtotalBeforeDiscount: number;
  discountPercentage: number;
  discountAmount: number;
  finalPrice: number;
  includedTons: number;
  overageRate: number;
  extraDayRate: number;
  includedRentalDays: number;
  isExemptExtraDays: boolean;
}

export async function calculatePriceForCustomer(
  pricingRepo: Repository<PricingRule>,
  customerRepo: Repository<Customer>,
  tenantId: string,
  customerId: string | null,
  assetSubtype: string,
): Promise<PriceCalculation> {
  // Get default pricing rule
  const rule = await pricingRepo.findOne({
    where: { tenant_id: tenantId, asset_subtype: assetSubtype, is_active: true },
  });

  let basePrice = rule ? Number(rule.base_price) : 0;
  let deliveryFee = rule ? Number(rule.delivery_fee) : 0;
  let includedTons = rule ? Number(rule.included_tons) : 0;
  let overageRate = rule ? Number(rule.overage_per_ton) : 0;
  let extraDayRate = rule ? Number(rule.extra_day_rate) : 0;
  let includedRentalDays = rule ? rule.rental_period_days : 14;
  let discountPercentage = 0;
  let isExemptExtraDays = false;

  // Check customer overrides
  if (customerId) {
    const customer = await customerRepo.findOne({ where: { id: customerId } });
    if (customer) {
      // Custom per-size pricing
      if (customer.custom_pricing && customer.custom_pricing[assetSubtype]) {
        const custom = customer.custom_pricing[assetSubtype];
        if (custom.basePrice != null) basePrice = custom.basePrice;
        if (custom.includedTons != null) includedTons = custom.includedTons;
        if (custom.overageRate != null) overageRate = custom.overageRate;
      }

      // Discount percentage
      if (customer.discount_percentage) {
        discountPercentage = Number(customer.discount_percentage);
      }

      // Extra day exemption
      if (customer.exempt_extra_day_charges) {
        isExemptExtraDays = true;
        extraDayRate = 0;
      }
    }
  }

  // Calculate: base + delivery + radius → then apply discount
  const radiusSurcharge = 0; // Distance calculation added later
  const subtotalBeforeDiscount = basePrice + deliveryFee + radiusSurcharge;
  const discountAmount = discountPercentage > 0 ? subtotalBeforeDiscount * (discountPercentage / 100) : 0;
  const finalPrice = subtotalBeforeDiscount - discountAmount;

  return {
    basePrice, deliveryFee, radiusSurcharge, subtotalBeforeDiscount,
    discountPercentage, discountAmount: Math.round(discountAmount * 100) / 100,
    finalPrice: Math.round(finalPrice * 100) / 100,
    includedTons, overageRate, extraDayRate, includedRentalDays, isExemptExtraDays,
  };
}
