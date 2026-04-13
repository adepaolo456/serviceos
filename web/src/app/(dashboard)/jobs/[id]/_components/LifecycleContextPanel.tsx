"use client";

/**
 * Phase 15 — Connected Job Lifecycle panel
 *
 * Renders the full rental-chain context for a job on the Job
 * Detail page. Fetches its own data from
 *   GET /jobs/:id/lifecycle-context
 * so the base job fetch stays lean (spec: "Job Detail page must
 * call this endpoint only when rendering the lifecycle panel —
 * NOT bloat the base job detail fetch").
 *
 * All labels come from the feature registry via getFeatureLabel
 * — NO hardcoded user-facing strings (spec rule).
 *
 * Alert data comes inline from the lifecycle-context response —
 * the panel never makes a parallel /alerts call.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Truck,
  Package,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  FileX,
  Scale,
  TrendingDown,
  GitBranch,
  CalendarClock,
} from "lucide-react";
import { api } from "@/lib/api";
import { getFeatureLabel, getFeature } from "@/lib/feature-registry";
import HelpTooltip from "@/components/ui/HelpTooltip";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABELS,
  displayStatusColor,
} from "@/lib/job-status";
import type {
  LifecycleContextResponse,
  LifecycleNode,
  LifecycleAlert,
  AlertSeverity,
} from "./lifecycle-context-types";
import EditJobDateModal, { type EditableJobType } from "./EditJobDateModal";

const EDITABLE_TASK_TYPES = new Set<EditableJobType>([
  "drop_off",
  "pick_up",
  "exchange",
]);

// ─────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "";
  try {
    // Accept both "2026-04-12" and full ISO
    const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  high: "var(--t-error)",
  medium: "var(--t-warning)",
  low: "var(--t-text-muted)",
};

// Task-type → icon map. Matches the vocabulary in
// task_chain_links.task_type (drop_off | pick_up | exchange).
const TASK_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  drop_off: Truck,
  pick_up: Package,
  exchange: RefreshCw,
};

// Alert-type → icon map, shared with the /alerts page.
const ALERT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  overdue_rental: Clock,
  missing_dump_slip: FileX,
  missing_asset: Package,
  abnormal_disposal: Scale,
  low_margin_chain: TrendingDown,
  lifecycle_integrity: GitBranch,
};

function alertFeatureId(alertType: string): string {
  return `alerts_${alertType}`;
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export default function LifecycleContextPanel({
  jobId,
}: {
  jobId: string;
}) {
  const [data, setData] = useState<LifecycleContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 16.1 — editing state for the shared Edit Job Date
  // modal. We stash the node being edited so the modal knows
  // the current date + job type without re-looking up state.
  // The `refetchKey` bump re-runs the fetch effect after a
  // successful save.
  const [editingNode, setEditingNode] = useState<LifecycleNode | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<LifecycleContextResponse>(`/jobs/${jobId}/lifecycle-context`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load lifecycle");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refetchKey]);

  const panelLabel = getFeatureLabel("connected_job_lifecycle");

  return (
    <div
      className="rounded-[18px] border p-5"
      style={{
        background: "var(--t-bg-card)",
        borderColor: "var(--t-border)",
      }}
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        <GitBranch
          className="h-[18px] w-[18px]"
          style={{ color: "var(--t-accent)" }}
        />
        <h3
          className="text-[15px] font-semibold"
          style={{ color: "var(--t-text-primary)" }}
        >
          {panelLabel}
        </h3>
        <HelpTooltip featureId="connected_job_lifecycle" placement="right" />
      </div>

      {/* ── Body states ───────────────────────────────────── */}
      {loading && (
        <p
          className="text-xs"
          style={{ color: "var(--t-text-muted)" }}
        >
          {getFeature("connected_job_lifecycle")?.shortDescription ?? ""}
        </p>
      )}

      {error && !loading && (
        <p
          className="text-xs"
          style={{ color: "var(--t-error)" }}
        >
          {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          {data.is_standalone ? (
            <EmptyState />
          ) : (
            <>
              {/* Chain-level alert banner (spec Q4: LOW_MARGIN_CHAIN,
                  LIFECYCLE_INTEGRITY, DATE_RULE_CONFLICT, OVERDUE_RENTAL
                  all land here — attached to the whole chain, not a node). */}
              {data.chain_alerts.length > 0 && (
                <ChainAlertBanner alerts={data.chain_alerts} />
              )}

              {/* Node list */}
              <div className="flex flex-col gap-2 mt-1">
                {data.nodes.map((node, idx) => (
                  <NodeRow
                    key={node.job_id}
                    node={node}
                    isLast={idx === data.nodes.length - 1}
                    onEditDate={setEditingNode}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Phase 16.1 — shared Edit Job Date modal. Rendered at
          the panel level so the fetch + refetch cycle stays
          owned by one component. Only mounts when we have a
          node to edit AND the chain has both bounds populated —
          the modal needs drop_off_date and expected_pickup_date
          to compute its validation/preview. */}
      {editingNode &&
        EDITABLE_TASK_TYPES.has(editingNode.task_type as EditableJobType) &&
        data?.chain?.drop_off_date &&
        data?.chain?.expected_pickup_date &&
        editingNode.scheduled_date && (
          <EditJobDateModal
            jobId={editingNode.job_id}
            jobType={editingNode.task_type as EditableJobType}
            currentDate={editingNode.scheduled_date}
            dropOffDate={data.chain.drop_off_date}
            expectedPickupDate={data.chain.expected_pickup_date}
            onClose={() => setEditingNode(null)}
            onSaved={() => setRefetchKey((k) => k + 1)}
          />
        )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="py-6 text-center">
      <GitBranch
        className="mx-auto h-8 w-8 mb-2"
        style={{ color: "var(--t-text-muted)" }}
      />
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--t-text-primary)" }}
      >
        {getFeatureLabel("connected_job_lifecycle_empty")}
      </p>
      <p
        className="mt-1 text-xs max-w-sm mx-auto"
        style={{ color: "var(--t-text-muted)" }}
      >
        {getFeature("connected_job_lifecycle_empty")?.shortDescription ?? ""}
      </p>
    </div>
  );
}

function ChainAlertBanner({ alerts }: { alerts: LifecycleAlert[] }) {
  // Order: high → medium → low, already sorted by the backend.
  const highestSeverity = alerts[0]?.severity ?? "medium";
  return (
    <div
      className="rounded-[12px] border p-3 mb-4"
      style={{
        background: "var(--t-bg-elevated)",
        borderColor: SEVERITY_COLOR[highestSeverity],
        borderLeftWidth: 3,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle
          className="h-3.5 w-3.5"
          style={{ color: SEVERITY_COLOR[highestSeverity] }}
        />
        <p
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: SEVERITY_COLOR[highestSeverity] }}
        >
          {getFeatureLabel("related_jobs_panel_chain_alerts")}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {alerts.map((a) => {
          const Icon = ALERT_ICON[a.alert_type] ?? AlertTriangle;
          const featureId = alertFeatureId(a.alert_type);
          return (
            <Link
              key={a.id}
              href={`/alerts`}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium no-underline"
              style={{
                background: "var(--t-bg-card)",
                border: `1px solid ${SEVERITY_COLOR[a.severity]}`,
                color: "var(--t-text-primary)",
              }}
            >
              <Icon className="h-3 w-3" />
              {getFeatureLabel(featureId)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NodeRow({
  node,
  isLast,
  onEditDate,
}: {
  node: LifecycleNode;
  isLast: boolean;
  onEditDate: (node: LifecycleNode) => void;
}) {
  const displayStatus = deriveDisplayStatus(node.status);
  const TaskIcon = TASK_TYPE_ICON[node.task_type] ?? ArrowRight;
  const isCancelled =
    node.status === "cancelled" ||
    node.link_status === "cancelled" ||
    !!node.cancelled_at;

  // Phase 16.1 — "Edit Date" action is now available on
  // delivery, pickup, AND exchange nodes (previously pickup
  // only). Same cancellation gate as Phase 16 — cancelled
  // rows remain read-only — plus we still require a
  // scheduled_date to hand to the modal as the current value.
  const canEditDate =
    EDITABLE_TASK_TYPES.has(node.task_type as EditableJobType) &&
    node.link_status !== "cancelled" &&
    !node.cancelled_at &&
    !!node.scheduled_date;

  // Button label is type-specific — resolved from the
  // registry family matching the task_type.
  const editButtonLabelKey = (() => {
    if (node.task_type === "drop_off") return "edit_delivery_date_button_label";
    if (node.task_type === "exchange") return "edit_exchange_date_button_label";
    return "edit_pickup_date_button_label";
  })();

  // Current-step emphasis: accent border + soft fill. Cancelled:
  // muted. Otherwise: neutral card.
  const borderColor = node.is_current
    ? "var(--t-accent)"
    : isCancelled
      ? "var(--t-border)"
      : "var(--t-border)";
  const backgroundColor = node.is_current
    ? "var(--t-accent-soft)"
    : "transparent";
  const opacity = isCancelled && !node.is_current ? 0.55 : 1;

  return (
    <>
      <div
        className="flex items-start gap-3 rounded-[14px] border px-3.5 py-3 transition-colors"
        style={{
          borderColor,
          backgroundColor,
          opacity,
          borderWidth: node.is_current ? 2 : 1,
        }}
      >
        {/* Inner Link wraps the icon + textual content so clicking
            anywhere on the content area deep-links to the job,
            while leaving the action area (Edit Pickup Date button +
            completion checkmark) outside the Link so the button
            isn't nested inside an anchor (invalid HTML + React
            warning) and so clicks on the button don't also
            navigate. */}
        <Link
          href={`/jobs/${node.job_id}`}
          className="flex flex-1 items-start gap-3 no-underline min-w-0"
        >
        {/* Task-type icon */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background: node.is_current
              ? "var(--t-accent)"
              : "var(--t-bg-elevated)",
            color: node.is_current ? "#fff" : "var(--t-text-muted)",
          }}
        >
          <TaskIcon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row: task-type label + current badge + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{
                color: node.is_current
                  ? "var(--t-accent)"
                  : "var(--t-text-muted)",
              }}
            >
              {getFeatureLabel(`related_jobs_panel_task_${node.task_type}`)}
            </span>
            {node.is_current && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5"
                style={{
                  background: "var(--t-accent)",
                  color: "#fff",
                }}
              >
                {getFeatureLabel("related_jobs_current")}
              </span>
            )}
            <span
              className="text-xs font-medium"
              style={{ color: "var(--t-text-primary)" }}
            >
              {node.job_number}
            </span>
            <span
              className="text-[10px] font-semibold"
              style={{ color: displayStatusColor(displayStatus) }}
            >
              · {DISPLAY_STATUS_LABELS[displayStatus] ?? node.status}
            </span>
          </div>

          {/* Middle row: date + size + asset */}
          <div
            className="flex items-center gap-2 flex-wrap mt-1 text-[11px]"
            style={{ color: "var(--t-text-muted)" }}
          >
            {node.scheduled_date ? (
              <span>{fmtDate(node.scheduled_date)}</span>
            ) : (
              <span>
                {getFeatureLabel("related_jobs_panel_no_date")}
              </span>
            )}
            {node.asset_subtype && (
              <>
                <span>·</span>
                <span>{node.asset_subtype}</span>
              </>
            )}
            <span>·</span>
            {node.asset_id ? (
              <span>
                {getFeatureLabel("related_jobs_panel_asset_assigned")}
              </span>
            ) : (
              <span style={{ color: "var(--t-warning)" }}>
                {getFeatureLabel("related_jobs_panel_no_asset")}
              </span>
            )}
          </div>

          {/* Cancellation subtitle — only shown when cancelled */}
          {isCancelled && node.cancellation_reason && (
            <div
              className="mt-1 text-[11px]"
              style={{ color: "var(--t-text-muted)" }}
            >
              <XCircle
                className="inline h-3 w-3 mr-1"
                style={{ color: "var(--t-error)" }}
              />
              {getFeatureLabel("related_jobs_panel_cancelled_prefix")}
              {": "}
              {node.cancellation_reason}
            </div>
          )}

          {/* Per-node alert pills */}
          {node.alerts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {node.alerts.map((a) => {
                const Icon = ALERT_ICON[a.alert_type] ?? AlertTriangle;
                return (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "var(--t-bg-elevated)",
                      color: SEVERITY_COLOR[a.severity],
                      border: `1px solid ${SEVERITY_COLOR[a.severity]}`,
                    }}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {getFeatureLabel(alertFeatureId(a.alert_type))}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        </Link>

        {/* Action area — sits OUTSIDE the Link so clicks here
            don't navigate and so the button isn't nested in an
            anchor. */}
        <div className="flex items-start gap-1.5 shrink-0">
          {canEditDate && (
            <button
              onClick={() => onEditDate(node)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                background: "var(--t-bg-elevated)",
                border: "1px solid var(--t-border)",
                color: "var(--t-text-primary)",
              }}
            >
              <CalendarClock className="h-3 w-3" />
              {getFeatureLabel(editButtonLabelKey)}
            </button>
          )}
          {/* Completion checkmark */}
          {node.completed_at && !isCancelled && (
            <CheckCircle2
              className="h-4 w-4 shrink-0 mt-1"
              style={{ color: "var(--t-accent)" }}
            />
          )}
        </div>
      </div>

      {/* Connector line between nodes (skip after the last one) */}
      {!isLast && (
        <div
          className="ml-4 h-2 w-px"
          style={{ background: "var(--t-border)" }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
