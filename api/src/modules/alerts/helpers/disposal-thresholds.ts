/**
 * Phase 14 — fallback disposal thresholds for the ABNORMAL_DISPOSAL
 * detector.
 *
 * These values are INTENTIONALLY conservative. The point of the
 * alert is to catch obvious outliers (a 20yd ticket weighing 12
 * tons, a 10yd ticket costing $800) — not to second-guess normal
 * variance. False positives in this category erode trust in the
 * whole alert system, so the defaults are generous on the high end.
 *
 * TODO(phase-14.1): move to a tenant-configurable table keyed by
 * (tenant_id, size). Until then every tenant uses these defaults.
 */

export interface DisposalThreshold {
  /** Hard cap in tons; weights above this are flagged abnormal. */
  max_weight_tons: number;
  /** Hard cap in USD for total dump cost; values above flagged. */
  max_cost_usd: number;
}

/**
 * Keyed by the normalized numeric size string extracted from
 * `jobs.asset_subtype`. Matches common roll-off sizes.
 */
const DEFAULTS: Record<string, DisposalThreshold> = {
  '10': { max_weight_tons: 3, max_cost_usd: 300 },
  '15': { max_weight_tons: 4, max_cost_usd: 400 },
  '20': { max_weight_tons: 5, max_cost_usd: 500 },
  '30': { max_weight_tons: 7, max_cost_usd: 700 },
  '40': { max_weight_tons: 9, max_cost_usd: 900 },
};

/** Used when size is unknown or not in DEFAULTS — generous fallback. */
const FALLBACK: DisposalThreshold = {
  max_weight_tons: 10,
  max_cost_usd: 1000,
};

/**
 * Returns the threshold for a given size string. Handles values
 * like "20", "20yd", "20 yard", "20-yard" by stripping non-digits.
 */
export function getDisposalThreshold(
  size: string | null | undefined,
): DisposalThreshold {
  if (!size) return FALLBACK;
  const numeric = String(size).replace(/[^0-9]/g, '');
  if (!numeric) return FALLBACK;
  return DEFAULTS[numeric] ?? FALLBACK;
}
