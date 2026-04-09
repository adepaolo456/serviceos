"use client";

import Link from "next/link";
import { ArrowRight, Truck } from "lucide-react";
import {
  CUSTOMER_DASHBOARD_LABELS,
  jobTaskTypeLabel,
} from "@/lib/customer-dashboard-labels";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABELS,
  displayStatusColor,
} from "@/lib/job-status";
import type {
  DashboardChain,
  DashboardJobLink,
  DashboardJobsTimeline,
  DashboardStandaloneJob,
} from "@/lib/customer-dashboard-types";

/**
 * Jobs Timeline — CORE dashboard component.
 *
 * Renders rental chains as ordered link sequences (the existing
 * task_chain_links prev/next relationship) so a user can see
 * Delivery → Exchange → Pickup at a glance, then standalone jobs
 * below. Display-status derivation is delegated to the existing
 * `web/src/lib/job-status.ts` helper so this file does not duplicate
 * that logic.
 */
export default function JobsTimeline({
  data,
}: {
  data: DashboardJobsTimeline;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;
  const hasChains = data.chains.length > 0;
  const hasStandalone = data.standaloneJobs.length > 0;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-3">
        {L.sections.jobsTimeline}
      </h3>

      {!hasChains && !hasStandalone && (
        <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">
          {L.empty.noJobs}
        </p>
      )}

      {hasChains && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-2">
            {L.fields.chainsHeading}
          </p>
          <div className="space-y-3">
            {data.chains.map((chain) => (
              <ChainRow key={chain.chainId} chain={chain} />
            ))}
          </div>
        </div>
      )}

      {hasStandalone && (
        <div className={hasChains ? "border-t border-[var(--t-border)] pt-3" : ""}>
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-2">
            {L.fields.standaloneHeading}
          </p>
          <div className="space-y-1.5">
            {data.standaloneJobs.map((job) => (
              <StandaloneJobRow key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Chain rendering
// ────────────────────────────────────────────────────────────────────

function ChainRow({ chain }: { chain: DashboardChain }) {
  return (
    <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
            {chain.dumpsterSize || "—"}
          </span>
          <span className="text-[10px] text-[var(--t-text-muted)]">
            {chain.dropOffDate}
          </span>
        </div>
        <span className="text-[10px] text-[var(--t-text-muted)] capitalize">
          {chain.status}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chain.links.map((link, idx) => (
          <div key={link.linkId} className="flex items-center gap-1.5">
            <ChainLinkPill link={link} />
            {idx < chain.links.length - 1 && (
              <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)] shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainLinkPill({ link }: { link: DashboardJobLink }) {
  const displayStatus = deriveDisplayStatus(
    link.jobStatus,
    link.linkedInvoiceStatus,
  );
  return (
    <Link
      href={`/jobs/${link.jobId}`}
      className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-2.5 py-1 text-[11px] hover:opacity-80 transition-opacity"
    >
      <span className="font-medium text-[var(--t-text-primary)]">
        {jobTaskTypeLabel(link.taskType)}
      </span>
      <span
        className="text-[10px] font-medium"
        style={{ color: displayStatusColor(displayStatus) }}
      >
        {DISPLAY_STATUS_LABELS[displayStatus]}
      </span>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// Standalone jobs
// ────────────────────────────────────────────────────────────────────

function StandaloneJobRow({ job }: { job: DashboardStandaloneJob }) {
  const displayStatus = deriveDisplayStatus(
    job.jobStatus,
    job.linkedInvoiceStatus,
  );
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center justify-between rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-3 py-2 hover:opacity-80 transition-opacity"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs font-medium text-[var(--t-text-primary)]">
          {job.jobNumber}
        </span>
        <span className="text-[11px] text-[var(--t-text-muted)] capitalize">
          {jobTaskTypeLabel(job.jobType)}
        </span>
        {job.assetSubtype && (
          <span className="text-[11px] text-[var(--t-text-muted)]">
            {job.assetSubtype}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-[var(--t-text-muted)]">
          {job.scheduledDate || "—"}
        </span>
        <span
          className="text-[10px] font-medium"
          style={{ color: displayStatusColor(displayStatus) }}
        >
          {DISPLAY_STATUS_LABELS[displayStatus]}
        </span>
      </div>
    </Link>
  );
}
