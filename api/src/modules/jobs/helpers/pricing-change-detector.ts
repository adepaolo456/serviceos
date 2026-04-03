import { Job } from '../entities/job.entity';

/**
 * Fields that, when changed, require pricing recalculation.
 * All other job fields are non-pricing and must NOT trigger repricing.
 */
interface PricingChangeResult {
  changed: boolean;
  reasons: string[];
}

/**
 * Detects whether a job update contains changes to pricing-relevant fields.
 * Centralized so all job update paths use the same rules.
 */
export function hasPricingRelevantChanges(
  existingJob: Job,
  updateDto: Record<string, unknown>,
): PricingChangeResult {
  const reasons: string[] = [];

  // Explicit recalculation request — always triggers
  if (updateDto.recalculate === true) {
    reasons.push('explicit_recalculate_requested');
  }

  // Service address changed
  if (updateDto.serviceAddress !== undefined) {
    const oldAddr = existingJob.service_address;
    const newAddr = updateDto.serviceAddress as Record<string, unknown> | null;
    if (JSON.stringify(oldAddr) !== JSON.stringify(newAddr)) {
      reasons.push('service_address_changed');
    }
  }

  // Customer address changed (alias)
  if (updateDto.customerAddress !== undefined) {
    reasons.push('customer_address_changed');
  }

  // Yard changed
  if (updateDto.yardId !== undefined) {
    reasons.push('yard_changed');
  }

  // Asset subtype changed
  if (updateDto.assetSubtype !== undefined) {
    const oldSubtype = existingJob.asset_subtype;
    const newSubtype = updateDto.assetSubtype as string;
    if (oldSubtype !== newSubtype) {
      reasons.push('asset_subtype_changed');
    }
  }

  // Service type changed
  if (updateDto.serviceType !== undefined) {
    const oldType = existingJob.service_type;
    const newType = updateDto.serviceType as string;
    if (oldType !== newType) {
      reasons.push('service_type_changed');
    }
  }

  // Job type changed (delivery → pickup → exchange)
  if (updateDto.jobType !== undefined) {
    const oldType = existingJob.job_type;
    const newType = updateDto.jobType as string;
    if (oldType !== newType) {
      reasons.push('job_type_changed');
    }
  }

  // Rental period days changed
  if (updateDto.rentalDays !== undefined) {
    const oldDays = existingJob.rental_days;
    const newDays = updateDto.rentalDays as number;
    if (oldDays !== newDays) {
      reasons.push('rental_period_days_changed');
    }
  }

  // Rental type changed (residential/commercial)
  if (updateDto.rentalType !== undefined) {
    reasons.push('rental_type_changed');
  }

  // Exchange context changed
  if (updateDto.exchange_context !== undefined) {
    reasons.push('exchange_context_changed');
  }

  return {
    changed: reasons.length > 0,
    reasons,
  };
}
