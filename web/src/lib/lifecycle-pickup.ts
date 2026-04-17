/**
 * Active-pickup-node selection — single source of truth.
 *
 * This helper MUST be used anywhere the "active pickup node" is selected.
 * Do not reimplement inline derivation logic in consumer components.
 * Adding a new consumer? Import selectActivePickupNode. Do not copy the logic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Contract
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Active pickup node = the single `pick_up` task for a rental chain that is
 * currently expected to happen.
 *
 * Filter (all must be true):
 *   - task_type === "pick_up"
 *   - status !== "cancelled"
 *   - link_status !== "cancelled"
 *   - scheduled_date is truthy (the row has a real scheduled date,
 *     not null/empty)
 *
 * Tiebreak (when multiple candidates somehow exist — should not happen in
 * steady state because createExchange / handleTypeChange atomically cancel
 * the prior pickup before creating the replacement, but the helper must
 * still be deterministic):
 *
 *   1. Sequence partition (primary). If any candidate has a numeric
 *      sequence_number, ignore all candidates without sequence_number for
 *      primary selection. Among the remaining, the highest sequence_number
 *      wins.
 *   2. Scheduled-date fallback. If no candidate has sequence_number, fall
 *      back to the candidate with the latest scheduled_date (string ISO
 *      compare).
 *   3. Id fallback. If still tied (same sequence_number or same
 *      scheduled_date), highest id wins as a stable tiebreak.
 *
 * Returns null when no candidate passes the filter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why these rules
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - Sequence partition: mixed-quality data (some rows with sequence_number,
 *   some without) must not produce inconsistent behavior. Once
 *   sequence_number exists on any candidate, it is the authoritative sort
 *   key — rows missing it are dropped from primary selection.
 * - sequence_number beats scheduled_date as primary tiebreak: a newly
 *   created exchange pickup has a higher sequence_number than the one it
 *   replaced even if the operator back-dated the new pickup to before the
 *   old one. Sort by scheduled_date would pick the older row in that case.
 * - scheduled_date truthiness filter: a pickup without a scheduled date is
 *   not actionable on either consuming surface.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Pure module
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No React, no hooks, no Next.js imports. Pure functions, no side effects,
 * no logging, no network. Side-effectful broadcast logic lives in
 * lifecycle-sync.ts; do not couple this module to it.
 */

/**
 * Canonical input shape (snake_case, matching backend lifecycle DTO).
 * Each call site adapts its local row shape to this before invoking
 * selectActivePickupNode.
 */
export interface PickupCandidate {
  id: string;
  task_type: string;
  status: string;
  link_status: string;
  scheduled_date: string | null;
  sequence_number: number | null;
}

export function selectActivePickupNode(
  nodes: PickupCandidate[],
): PickupCandidate | null {
  const candidates = nodes.filter(
    (n) =>
      n.task_type === "pick_up" &&
      n.status !== "cancelled" &&
      n.link_status !== "cancelled" &&
      !!n.scheduled_date,
  );
  if (candidates.length === 0) return null;

  // Step 1 — sequence partition. If any candidate has a numeric
  // sequence_number, only those candidates are eligible for primary
  // selection; rows with null/missing sequence_number are dropped.
  const withSeq = candidates.filter(
    (c) => typeof c.sequence_number === "number",
  );

  if (withSeq.length > 0) {
    return withSeq.reduce<PickupCandidate | null>((max, c) => {
      if (!max) return c;
      const cs = c.sequence_number as number;
      const ms = max.sequence_number as number;
      if (cs > ms) return c;
      if (cs < ms) return max;
      // Tie — id fallback (highest string id wins, deterministic).
      return c.id > max.id ? c : max;
    }, null);
  }

  // Step 2 — scheduled_date fallback (only reached when zero candidates
  // carry sequence_number).
  return candidates.reduce<PickupCandidate | null>((max, c) => {
    if (!max) return c;
    const cd = c.scheduled_date ?? "";
    const md = max.scheduled_date ?? "";
    if (cd > md) return c;
    if (cd < md) return max;
    return c.id > max.id ? c : max;
  }, null);
}

// ───────────────────────────────────────────────────────────────────────
// Adapters — one per consumer call site, kept here (not at the call site)
// so the unit test can exercise the call-site mapping logic and assert
// the integration guarantee that both adapters produce equivalent
// candidates from equivalent source data.
// ───────────────────────────────────────────────────────────────────────

/**
 * Adapter for the snake_case backend lifecycle node shape used by
 * LifecycleContextPanel (mirrors api/src/modules/jobs/dto/lifecycle-context.dto.ts).
 *
 * Accepts a structural shape rather than importing LifecycleNode directly
 * to keep `lib/` free of dependencies on `app/`-layer components.
 */
export interface SnakeCaseLifecycleNodeLike {
  job_id: string;
  task_type: string;
  status: string;
  link_status: string;
  scheduled_date: string | null;
  sequence_number: number;
}

export function toCandidateFromSnakeCaseNode(
  n: SnakeCaseLifecycleNodeLike,
): PickupCandidate {
  return {
    id: n.job_id,
    task_type: n.task_type,
    status: n.status,
    link_status: n.link_status,
    scheduled_date: n.scheduled_date,
    sequence_number: n.sequence_number,
  };
}

/**
 * Adapter for the camelCase rental-chains lifecycle job shape used by
 * the rentals admin page (mirrors getLifecycle's jobs[] projection in
 * api/src/modules/rental-chains/rental-chains.service.ts).
 *
 * sequence_number is required and non-nullable here because the
 * /rental-chains/:id/lifecycle endpoint guarantees it on every jobs[]
 * entry — see Prereq-0 commit 0b764ad which added the projection field
 * sourced from the non-nullable link.sequence_number column. The
 * rentals-page CTA therefore agrees with LifecycleContextPanel for the
 * back-dated-exchange case (and every other case), with no fallback
 * branch to drift out of sync.
 */
export interface CamelCaseRentalLifecycleJobLike {
  id: string;
  taskType: string;
  status: string;
  linkStatus?: string;
  scheduledDate: string | null;
  sequence_number: number;
}

export function toCandidateFromCamelCaseJob(
  j: CamelCaseRentalLifecycleJobLike,
): PickupCandidate {
  return {
    id: j.id,
    task_type: j.taskType,
    status: j.status,
    link_status: j.linkStatus ?? "",
    scheduled_date: j.scheduledDate || null,
    sequence_number: j.sequence_number,
  };
}
