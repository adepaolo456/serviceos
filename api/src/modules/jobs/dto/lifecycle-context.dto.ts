/**
 * Phase 15 — Connected Job Lifecycle response contract
 *
 * Shape returned by `GET /jobs/:id/lifecycle-context`. This is the
 * sole read model for the Connected Job Lifecycle panel on the
 * Job Detail page. The panel fetches this endpoint and never
 * makes a parallel `/alerts` call — all alert indicators come
 * inline via `chain_alerts` + `node.alerts`.
 *
 * Ordering rule: `nodes` is ALWAYS sorted by `jobs.scheduled_date
 * ASC` (spec: "DO NOT invent custom ordering systems"). Jobs
 * with null scheduled_date sort last per Postgres default.
 *
 * Standalone jobs (not part of any rental chain) return
 * `{ is_standalone: true, chain: null, nodes: [], chain_alerts: [] }`
 * so the frontend can render a registry-driven empty state without
 * a second round trip.
 */

export interface LifecycleAlert {
  id: string;
  alert_type: string;
  severity: 'high' | 'medium' | 'low';
  message: string; // feature registry key — resolve via getFeatureLabel
  metadata: Record<string, unknown>;
}

export interface LifecycleChainSummary {
  id: string;
  status: string; // active | completed | cancelled
  drop_off_date: string | null;
  expected_pickup_date: string | null;
  actual_pickup_date: string | null;
  dumpster_size: string | null;
  rental_days: number | null;
}

export interface LifecycleNode {
  job_id: string;
  job_number: string;
  job_type: string; // delivery | pickup | exchange | dump_run
  /** task_type from task_chain_links — drop_off | pick_up | exchange */
  task_type: string;
  sequence_number: number;
  status: string; // raw job status (display-mapping happens in UI)
  scheduled_date: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  link_status: string; // task_chain_links.status
  asset_id: string | null;
  /**
   * Denormalized job-level dumpster size — per the project's
   * "denormalized UI fields" convention, read from
   * `jobs.asset_subtype` rather than joining to assets.
   */
  asset_subtype: string | null;
  /**
   * Live driver assignment. `null` when no driver is currently
   * assigned. Carried through so the UI can use the driver-aware
   * `deriveDisplayStatus` object form — otherwise the LifecyclePanel
   * would keep child nodes stuck on "Assigned" after the office
   * unassigned the driver from dispatch (the raw `status` column
   * can still be `dispatched`). Additive, nullable, no DB change.
   */
  assigned_driver_id: string | null;
  is_current: boolean;
  alerts: LifecycleAlert[]; // entity_type='job' alerts for THIS job only
}

export interface LifecycleContextResponse {
  current_job_id: string;
  is_standalone: boolean;
  chain: LifecycleChainSummary | null;
  nodes: LifecycleNode[]; // ordered by scheduled_date ASC
  /**
   * Chain-scoped alerts (entity_type='rental_chain'). Rendered as
   * a banner above the node list. Per Phase 15 design:
   * LOW_MARGIN_CHAIN, LIFECYCLE_INTEGRITY, DATE_RULE_CONFLICT,
   * and OVERDUE_RENTAL all land here.
   */
  chain_alerts: LifecycleAlert[];
}
