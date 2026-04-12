/**
 * Phase 16 — request body for PUT /jobs/:id/pickup-date.
 *
 * Narrow-by-design: the endpoint ONLY mutates the pickup date
 * (plus its downstream duration + reschedule audit trio). No
 * pricing, no invoice, no rental_start/end_date. Reason is
 * hardcoded server-side to "operator_override_lifecycle_panel"
 * per Phase 16 Q2.
 */
export interface UpdatePickupDateDto {
  /** New pickup date in YYYY-MM-DD format. */
  pickup_date: string;
}
