"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, RefreshCw, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { useToast } from "@/components/toast";
import { navigateBack } from "@/lib/navigation";

/* ── Types (must mirror backend service exports) ── */

type Confidence = "high" | "medium" | "low";
type InferredChainType =
  | "delivery_pickup"
  | "delivery_exchange_pickup"
  | "delivery_only"
  | "orphan";

interface CandidateJob {
  job_id: string;
  job_number: string;
  job_type: string;
  status: string;
  scheduled_date: string | null;
}

interface CandidateChain {
  id: string;
  confidence: Confidence;
  customer_id: string;
  customer_name: string;
  address: string;
  asset_subtype: string | null;
  jobs: CandidateJob[];
  inferred_chain_type: InferredChainType;
}

interface AuditSummary {
  total_jobs: number;
  chained_jobs: number;
  standalone_jobs: number;
  unlinked_exchanges: number;
  candidate_count: number;
  by_confidence: { high: number; medium: number; low: number };
  by_pattern: Record<InferredChainType, number>;
}

/* ── Helpers ── */

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const CONFIDENCE_STYLES: Record<Confidence, { bg: string; text: string; label: string }> = {
  high: {
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-500",
    label: FEATURE_REGISTRY.confidence_high?.label ?? "High Confidence",
  },
  medium: {
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-500",
    label: FEATURE_REGISTRY.confidence_medium?.label ?? "Medium Confidence",
  },
  low: {
    bg: "bg-rose-500/10 border-rose-500/30",
    text: "text-rose-500",
    label: FEATURE_REGISTRY.confidence_low?.label ?? "Low Confidence",
  },
};

const PATTERN_LABELS: Record<InferredChainType, string> = {
  delivery_pickup: "Delivery → Pickup",
  delivery_exchange_pickup: "Delivery → Exchange → Pickup",
  delivery_only: "Delivery only (no pickup)",
  orphan: "Orphan — needs manual review",
};

const TASK_COLORS: Record<string, string> = {
  delivery: "text-blue-400",
  drop_off: "text-blue-400",
  pickup: "text-orange-400",
  removal: "text-orange-400",
  exchange: "text-purple-400",
};

/* ── Page ── */

export default function LegacyBackfillPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [candidates, setCandidates] = useState<CandidateChain[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionApproved, setSessionApproved] = useState(0);
  const [sessionRejected, setSessionRejected] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api.get<AuditSummary>("/admin/legacy-backfill/audit"),
        api.get<CandidateChain[]>("/admin/legacy-backfill/candidates"),
      ]);
      setAudit(a);
      setCandidates(c);
    } catch {
      /* handled by empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .get<{ id: string; role: string }>("/auth/profile")
      .then((u) => setUserRole(u.role ?? null))
      .catch(() => setUserRole(null));
    reload();
  }, [reload]);

  const isOwner = userRole === "owner";

  const handleApprove = async (candidate: CandidateChain) => {
    setBusy(candidate.id);
    try {
      const jobIds = candidate.jobs.map((j) => j.job_id);
      await api.post<{ rental_chain_id: string; linked_job_ids: string[] }>(
        "/admin/legacy-backfill/approve",
        { job_ids: jobIds },
      );
      toast(
        "success",
        (FEATURE_REGISTRY.approve_chain?.label ?? "Chain approved"),
      );
      setSessionApproved((n) => n + 1);
      await reload();
    } catch (err: unknown) {
      toast(
        "error",
        err instanceof Error ? err.message : "Failed to approve chain",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (candidate: CandidateChain) => {
    setBusy(candidate.id);
    try {
      const jobIds = candidate.jobs.map((j) => j.job_id);
      await api.post("/admin/legacy-backfill/reject", { job_ids: jobIds });
      toast(
        "success",
        FEATURE_REGISTRY.reject_chain?.label ?? "Candidate rejected",
      );
      setSessionRejected((n) => n + 1);
      await reload();
    } catch (err: unknown) {
      toast(
        "error",
        err instanceof Error ? err.message : "Failed to reject candidate",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!loading && userRole && !isOwner) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <p className="text-sm text-[var(--t-text-muted)]">
          This page is restricted to the account owner.
        </p>
        {/* History-first back nav. Falls back to the dashboard root
            when opened directly. The previous hardcoded `<Link>` was
            one of the sites explicitly flagged by the back-nav audit
            because it ignored real browser history. */}
        <button
          type="button"
          onClick={() => navigateBack(router, "/")}
          className="inline-flex items-center gap-1 mt-3 text-[var(--t-accent)] hover:underline text-sm"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
      </div>
    );
  }

  const chainedPct =
    audit && audit.total_jobs > 0
      ? Math.round((audit.chained_jobs / audit.total_jobs) * 100)
      : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-[var(--t-text-primary)]">
          {FEATURE_REGISTRY.legacy_backfill?.label ?? "Legacy Job Backfill"}
        </h1>
        <p className="text-sm text-[var(--t-text-muted)] mt-1">
          {FEATURE_REGISTRY.legacy_backfill_description?.label ??
            "Review and link standalone jobs into rental chains"}
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
            {FEATURE_REGISTRY.backfill_summary?.label ?? "Backfill Summary"}
          </h2>
          <button
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-1 text-[11px] font-medium text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {!audit ? (
          <p className="text-xs text-[var(--t-text-muted)]">Loading audit…</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                Chained
              </p>
              <p className="text-lg font-bold text-[var(--t-text-primary)] tabular-nums">
                {audit.chained_jobs}
                <span className="text-xs font-normal text-[var(--t-text-muted)]"> / {audit.total_jobs}</span>
              </p>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">{chainedPct}% coverage</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                {FEATURE_REGISTRY.standalone_jobs_remaining?.label ?? "Standalone Jobs Remaining"}
              </p>
              <p className="text-lg font-bold text-[var(--t-text-primary)] tabular-nums">
                {audit.standalone_jobs}
              </p>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
                {audit.unlinked_exchanges} unlinked exchanges
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                Candidates found
              </p>
              <p className="text-lg font-bold text-[var(--t-text-primary)] tabular-nums">
                {audit.candidate_count}
              </p>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
                {audit.by_confidence.high} high · {audit.by_confidence.medium} med · {audit.by_confidence.low} low
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                Session
              </p>
              <p className="text-lg font-bold text-[var(--t-text-primary)] tabular-nums">
                {sessionApproved} <span className="text-xs font-normal text-[var(--t-text-muted)]">approved</span>
              </p>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
                {sessionRejected} {FEATURE_REGISTRY.chains_rejected?.label ?? "rejected"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Candidates */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
          {FEATURE_REGISTRY.review_chain?.label ?? "Review Proposed Chain"} ({candidates?.length ?? 0})
        </h2>

        {loading && !candidates && (
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5 text-center text-xs text-[var(--t-text-muted)]">
            Loading candidates…
          </div>
        )}

        {candidates && candidates.length === 0 && !loading && (
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--t-accent)] mx-auto mb-2" />
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">No candidates remain</p>
            <p className="text-xs text-[var(--t-text-muted)] mt-1">
              Every standalone job has been reviewed or the detector found no
              matching groups.
            </p>
          </div>
        )}

        {candidates?.map((c) => {
          const conf = CONFIDENCE_STYLES[c.confidence];
          const isBusy = busy === c.id;
          return (
            <div
              key={c.id}
              className={`rounded-[20px] border p-5 ${conf.bg}`}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--t-bg-card)] ${conf.text}`}>
                      {conf.label}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--t-text-muted)]">
                      {PATTERN_LABELS[c.inferred_chain_type]}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[var(--t-text-primary)]">
                    {c.customer_name}
                  </p>
                  <p className="text-xs text-[var(--t-text-muted)]">
                    {c.address}
                    {c.asset_subtype && (
                      <span className="ml-2 font-medium text-[var(--t-text-primary)]">· {c.asset_subtype}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => handleReject(c)}
                    disabled={isBusy || !isOwner}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-1.5 text-[11px] font-medium text-[var(--t-error)] hover:bg-[var(--t-error-soft)] disabled:opacity-40 transition-colors"
                  >
                    <XCircle className="h-3 w-3" />
                    {FEATURE_REGISTRY.reject_chain?.label ?? "Reject"}
                  </button>
                  <button
                    onClick={() => handleApprove(c)}
                    disabled={isBusy || !isOwner || c.inferred_chain_type === "orphan"}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--t-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                    title={c.inferred_chain_type === "orphan" ? "Orphan candidates cannot be auto-approved" : undefined}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {FEATURE_REGISTRY.approve_chain?.label ?? "Approve Chain"}
                  </button>
                </div>
              </div>

              {/* Timeline */}
              <div className="space-y-1.5">
                {c.jobs.map((j, i) => (
                  <Link
                    key={j.job_id}
                    href={`/jobs/${j.job_id}`}
                    className="flex items-center gap-3 rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--t-bg-elevated)] text-[10px] font-bold text-[var(--t-text-muted)]">
                      {i + 1}
                    </span>
                    <span className={`text-xs font-semibold capitalize ${TASK_COLORS[j.job_type] || "text-[var(--t-text-muted)]"}`}>
                      {j.job_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                    <span className="text-xs text-[var(--t-text-muted)]">{fmtDate(j.scheduled_date)}</span>
                    <span className="text-[10px] text-[var(--t-text-muted)] ml-auto uppercase">{j.status}</span>
                    <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)]" />
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
