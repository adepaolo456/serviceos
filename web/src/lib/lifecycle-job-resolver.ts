/**
 * Phase 3 — representative job resolver for inbound lifecycle
 * navigation. Shifts traffic from `/rentals/[chain_id]` to
 * `/jobs/[representative_job_id]` without introducing a new
 * backend endpoint or a blocking fetch purely for navigation.
 *
 * Resolution rules (in order of preference):
 *   1. Latest non-cancelled `pick_up` link (by sequence_number).
 *      The pickup is the live end of a rental chain — the most
 *      meaningful drill-through target when a chain has both
 *      completed delivery legs and an active pickup.
 *   2. Fall back to the latest non-cancelled link of any type.
 *      Handles pre-exchange chains and edge cases where the
 *      pickup link is missing or cancelled but the chain is
 *      otherwise active.
 *   3. `null` — caller MUST fall back to the chain route
 *      (`/rentals/[chain_id]`). Safe default; never navigate to
 *      `/jobs/undefined`.
 *
 * Pure / deterministic / no side effects. Intentionally reads a
 * narrow subset of link fields so any caller shape that is a
 * superset (CustomerChainLink, the jobs-page chain link shape,
 * the rental-chains list response link shape, etc.) can pass in
 * directly without adapters.
 */

export interface ChainLinkForResolver {
  job_id: string;
  task_type: string;
  sequence_number: number;
  status: string;
}

export function resolveRepresentativeJobId(
  links: ReadonlyArray<ChainLinkForResolver> | null | undefined,
): string | null {
  if (!links || links.length === 0) return null;

  const nonCancelled = links.filter(
    (l) => l.status !== "cancelled" && !!l.job_id,
  );
  if (nonCancelled.length === 0) return null;

  const pickups = nonCancelled.filter((l) => l.task_type === "pick_up");
  const pool = pickups.length > 0 ? pickups : nonCancelled;

  const target = pool.reduce(
    (max, l) => (l.sequence_number > max.sequence_number ? l : max),
    pool[0],
  );
  return target.job_id;
}
