/**
 * Phase 15 — Connected Job Lifecycle response types
 *
 * Mirrors the backend contract in
 *   api/src/modules/jobs/dto/lifecycle-context.dto.ts
 *
 * Keep this file in sync with the backend DTO. A narrow,
 * hand-rolled mirror is intentional — we don't auto-generate
 * types across the monorepo boundary, and the shape is small
 * enough that the discipline cost is low.
 */

export type AlertSeverity = "high" | "medium" | "low";

export interface LifecycleAlert {
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  /** Feature registry key — resolve via getFeatureLabel. */
  message: string;
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
  task_type: string; // drop_off | pick_up | exchange
  sequence_number: number;
  status: string; // raw job status
  scheduled_date: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  link_status: string;
  asset_id: string | null;
  asset_subtype: string | null;
  is_current: boolean;
  alerts: LifecycleAlert[];
}

export interface LifecycleContextResponse {
  current_job_id: string;
  is_standalone: boolean;
  chain: LifecycleChainSummary | null;
  nodes: LifecycleNode[];
  chain_alerts: LifecycleAlert[];
}
