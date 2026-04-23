// Job statuses that mean "job is no longer consuming inventory for
// projection / active-use purposes". Terminal states (completed, cancelled)
// plus failed and needs_reschedule — both of which leave the asset in a
// distinct physical state but are no longer committing capacity.
//
// IMPORTANT — this set is mirrored in two SQL partial indexes:
//   - idx_jobs_tenant_asset_id_active
//   - idx_jobs_tenant_drop_off_asset_id_active
// (see migrations/2026-04-23-add-jobs-tenant-asset-active-indexes.sql).
// The partial-index predicate MUST match this list exactly or the planner
// won't use them. Any change here requires a follow-up migration to
// rebuild both indexes with the new predicate.
export const TERMINAL_JOB_STATUSES = [
  'completed',
  'cancelled',
  'failed',
  'needs_reschedule',
] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];
