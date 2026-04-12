/**
 * Phase 16.1 — request body for PUT /jobs/:id/scheduled-date.
 *
 * Single consolidated endpoint for all three editable job types
 * (delivery, pickup, exchange). The handler branches on
 * `job.job_type` after loading the job; the body shape stays
 * identical across types so the shared EditJobDateModal can
 * send one payload.
 *
 * Replaces the Phase 16 PUT /jobs/:id/pickup-date endpoint.
 */
export interface UpdateScheduledDateDto {
  /** New scheduled date in YYYY-MM-DD format. */
  scheduled_date: string;
}
