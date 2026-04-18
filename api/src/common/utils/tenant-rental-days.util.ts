import { Repository } from 'typeorm';
import { TenantSettings } from '../../modules/tenant-settings/entities/tenant-settings.entity';

/**
 * Resolve the tenant's default rental duration.
 *
 * Source of truth: `tenant_settings.default_rental_period_days`
 * (per-tenant column; default 14 at the DB level).
 *
 * Fallback: returns 14 only when the `tenant_settings` row is absent
 * entirely, or when the column value is not a positive number, so new
 * tenants don't 500 before onboarding writes their settings row. This
 * matches the original semantic preserved from
 * `RentalChainsService.getTenantRentalDays` (now extracted).
 *
 * NOT sourced from `pricing_rules.rental_period_days`. That column
 * exists (per-tenant AND per-asset-subtype; default 7) and belongs to a
 * separate source-of-truth family used by the pricing / billing /
 * public services. Do NOT conflate the two: this helper is the
 * tenant-wide rental-duration default for non-pricing consumers
 * (exchange scheduling, reschedule preservation, quote/chain
 * defaults). Pricing-rule-scoped consumers read
 * `pricing_rules.rental_period_days` directly.
 *
 * This function lives in `common/utils` — following the
 * `issueNextJobNumber` precedent — because multiple services will need
 * the same resolution (quotes, rental-chains, jobs, portal, billing)
 * and a module-level helper with a caller-passed repository avoids the
 * circular-dependency web an inter-service call would create.
 */
export async function getTenantRentalDays(
  tenantSettingsRepo: Repository<TenantSettings>,
  tenantId: string,
): Promise<number> {
  const settings = await tenantSettingsRepo.findOne({
    where: { tenant_id: tenantId },
  });
  const days = settings?.default_rental_period_days;
  return typeof days === 'number' && days > 0 ? days : 14;
}
