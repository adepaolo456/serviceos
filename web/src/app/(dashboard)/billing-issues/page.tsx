"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle, Clock, Scale, FileX, Tag, DollarSign, FileText,
  RefreshCw, CheckCircle2, XCircle, Ban,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/utils";
import SlideOver from "@/components/slide-over";

const fmt = (n: number | null | undefined) => formatCurrency(n as number);

interface BillingIssue {
  id: string;
  issue_type: string;
  invoice_id: string | null;
  job_id: string | null;
  rental_chain_id: string | null;
  description: string;
  suggested_action: string | null;
  auto_resolvable: boolean;
  calculated_amount: number | null;
  days_overdue: number | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface Summary { total: number; by_type: Record<string, number> }

const ISSUE_TYPES = [
  { key: "all", label: "All", icon: AlertTriangle, color: "var(--t-text-primary)" },
  { key: "overdue_days", label: "Overdue Days", icon: Clock, color: "var(--t-warning)" },
  { key: "weight_overage", label: "Weight Overage", icon: Scale, color: "var(--t-warning)" },
  { key: "missing_dump_slip", label: "Missing Dump Slip", icon: FileX, color: "var(--t-text-muted)" },
  { key: "surcharge_gap", label: "Surcharge Gap", icon: Tag, color: "var(--t-warning)" },
  { key: "past_due_payment", label: "Past Due", icon: DollarSign, color: "var(--t-error)" },
  { key: "no_invoice", label: "No Invoice", icon: FileText, color: "var(--t-error)" },
  { key: "price_mismatch", label: "Price Mismatch", icon: AlertTriangle, color: "var(--t-warning)" },
];

const STATUS_FILTERS = [
  { value: "", label: "All Open" },
  { value: "open", label: "Open" },
  { value: "auto_resolved", label: "Auto-Resolved" },
  { value: "manually_resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const RESOLUTION_REASONS = [
  { value: "invoice_corrected", label: "Invoice corrected" },
  { value: "payment_matched", label: "Payment matched" },
  { value: "duplicate_dismissed", label: "Duplicate dismissed" },
  { value: "false_positive", label: "False positive / not an issue" },
  { value: "customer_contacted", label: "Customer contacted" },
  { value: "resolved_externally", label: "Resolved externally" },
  { value: "manual_review", label: "Manual review completed" },
];

export default function BillingIssuesPage() {
  const [issues, setIssues] = useState<BillingIssue[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, by_type: {} });
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [resolveTarget, setResolveTarget] = useState<BillingIssue | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolving, setResolving] = useState(false);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("issueType", typeFilter);
      const [res, sum] = await Promise.all([
        api.get<{ data: BillingIssue[]; meta: { total: number } }>(`/billing-issues?${params}`),
        api.get<Summary>("/billing-issues/summary"),
      ]);
      setIssues(res.data);
      setTotal(res.meta.total);
      setSummary(sum);
    } catch { /* */ } finally { setLoading(false); }
  }, [page, statusFilter, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.post<{ total_issues_found: number }>("/billing-issues/detect");
      toast("success", `Detection complete — ${result.total_issues_found} issue(s) found`);
      await fetchData();
    } catch { toast("error", "Detection failed"); }
    finally { setDetecting(false); }
  };

  const openResolvePanel = (issue: BillingIssue) => {
    setResolveTarget(issue);
    setResolveReason("");
    setResolveNotes("");
  };

  const confirmResolve = async () => {
    if (!resolveTarget || !resolveReason) return;
    setResolving(true);
    try {
      await api.put(`/billing-issues/${resolveTarget.id}/resolve`, {
        reason: resolveReason,
        notes: resolveNotes || undefined,
      });
      toast("success", "Issue resolved");
      setResolveTarget(null);
      await fetchData();
    } catch { toast("error", "Failed to resolve"); }
    finally { setResolving(false); }
  };

  const handleDismiss = async (id: string) => {
    try {
      await api.put(`/billing-issues/${id}/dismiss`);
      toast("success", "Issue dismissed");
      await fetchData();
    } catch { toast("error", "Failed to dismiss"); }
  };

  const getTypeInfo = (type: string) => ISSUE_TYPES.find(t => t.key === type) || ISSUE_TYPES[0];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Billing Issues</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">{summary.total} open issue{summary.total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-all hover:brightness-110 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Scanning..." : "Detect Issues"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {ISSUE_TYPES.map(t => {
          const isAll = t.key === "all";
          const count = isAll ? summary.total : (summary.by_type[t.key] || 0);
          const active = isAll ? typeFilter === "" : typeFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTypeFilter(active && !isAll ? "" : isAll ? "" : t.key)}
              className={`rounded-[16px] border p-3 text-left transition-all ${active ? "ring-2 ring-[var(--t-accent)]" : ""}`}
              style={{ background: active ? "var(--t-bg-elevated)" : "var(--t-bg-card)", borderColor: active ? "var(--t-accent)" : "var(--t-border)" }}
            >
              <t.icon className="h-4 w-4 mb-1.5" style={{ color: count > 0 ? t.color : "var(--t-text-muted)" }} />
              <p className="text-lg font-bold tabular-nums" style={{ color: count > 0 ? t.color : "var(--t-text-muted)" }}>
                {count}
              </p>
              <p className="text-[11px] font-medium" style={{ color: active ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                {t.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        >
          {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        >
          <option value="">All Types</option>
          {ISSUE_TYPES.filter(t => t.key !== "all").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {(statusFilter || typeFilter) && (
          <button onClick={() => { setStatusFilter(""); setTypeFilter(""); }}
            className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">
            Clear Filters
          </button>
        )}
      </div>

      {/* Issues List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 w-full animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle2 className="h-12 w-12 mb-4" style={{ color: "var(--t-accent)" }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--t-frame-text)" }}>
            {(statusFilter || typeFilter) ? "No matching issues" : "All clear!"}
          </h3>
          <p className="text-sm mb-4" style={{ color: "var(--t-frame-text-muted)" }}>
            {(statusFilter || typeFilter) ? "No billing issues match the current filters." : "No billing issues found."}
          </p>
          {(statusFilter || typeFilter) ? (
            <button onClick={() => { setStatusFilter(""); setTypeFilter(""); }}
              className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              Clear Filters
            </button>
          ) : (
            <button onClick={handleDetect} disabled={detecting}
              className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              Run Detection
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => {
            const typeInfo = getTypeInfo(issue.issue_type);
            const isOpen = issue.status === "open";
            const isAutoResolved = issue.status === "auto_resolved";
            return (
              <div
                key={issue.id}
                className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4"
                style={{ borderLeftWidth: 3, borderLeftColor: typeInfo.color }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <typeInfo.icon className="h-4 w-4 shrink-0" style={{ color: typeInfo.color }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: typeInfo.color }}>
                        {typeInfo.label}
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: isOpen ? "var(--t-error-soft)" : isAutoResolved ? "var(--t-accent-soft)" : "var(--t-bg-elevated)",
                          color: isOpen ? "var(--t-error)" : isAutoResolved ? "var(--t-accent)" : "var(--t-text-muted)",
                        }}
                      >
                        {issue.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm font-medium mb-1" style={{ color: "var(--t-text-primary)" }}>
                      {issue.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs" style={{ color: "var(--t-text-muted)" }}>
                      {issue.invoice_id && (
                        <Link href={`/invoices/${issue.invoice_id}`} className="hover:text-[var(--t-accent)]">
                          View Invoice
                        </Link>
                      )}
                      {issue.calculated_amount != null && (
                        <span className="tabular-nums font-medium" style={{ color: typeInfo.color }}>
                          {fmt(issue.calculated_amount)}
                        </span>
                      )}
                      {issue.days_overdue != null && (
                        <span>{issue.days_overdue} day{issue.days_overdue !== 1 ? "s" : ""} overdue</span>
                      )}
                      <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => openResolvePanel(issue)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--t-accent-soft)]"
                        style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                      >
                        <CheckCircle2 className="h-3 w-3" /> Resolve
                      </button>
                      <button
                        onClick={() => handleDismiss(issue.id)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
                        style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                      >
                        <Ban className="h-3 w-3" /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 25 + 1}-{Math.min(page * 25, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-30"
              style={{ borderColor: "var(--t-border)" }}>Prev</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total}
              className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-30"
              style={{ borderColor: "var(--t-border)" }}>Next</button>
          </div>
        </div>
      )}

      {/* Resolve Workflow Panel */}
      <SlideOver open={!!resolveTarget} onClose={() => setResolveTarget(null)} title="Resolve Issue">
        {resolveTarget && (() => {
          const typeInfo = getTypeInfo(resolveTarget.issue_type);
          return (
            <div className="space-y-5">
              {/* Issue summary */}
              <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-elevated)", borderColor: "var(--t-border)", borderLeftWidth: 3, borderLeftColor: typeInfo.color }}>
                <div className="flex items-center gap-2 mb-2">
                  <typeInfo.icon className="h-4 w-4" style={{ color: typeInfo.color }} />
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: typeInfo.color }}>{typeInfo.label}</span>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{resolveTarget.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                  {resolveTarget.calculated_amount != null && (
                    <span className="font-medium tabular-nums" style={{ color: typeInfo.color }}>{fmt(resolveTarget.calculated_amount)}</span>
                  )}
                  {resolveTarget.days_overdue != null && <span>{resolveTarget.days_overdue} days overdue</span>}
                  <span>{new Date(resolveTarget.created_at).toLocaleDateString()}</span>
                </div>
                {resolveTarget.invoice_id && (
                  <Link href={`/invoices/${resolveTarget.invoice_id}`} className="inline-flex items-center gap-1 text-xs font-medium mt-2" style={{ color: "var(--t-accent)" }}>
                    View Invoice
                  </Link>
                )}
              </div>

              {resolveTarget.suggested_action && (
                <div className="rounded-xl border p-3 text-xs" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>Suggested:</span> {resolveTarget.suggested_action}
                </div>
              )}

              {/* Resolution reason */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>Resolution Reason *</label>
                <select
                  value={resolveReason}
                  onChange={e => setResolveReason(e.target.value)}
                  className="w-full rounded-[14px] border px-3 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  <option value="">Select a reason...</option>
                  {RESOLUTION_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {/* Optional notes */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>Notes (optional)</label>
                <textarea
                  value={resolveNotes}
                  onChange={e => setResolveNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-[14px] border px-3 py-2.5 text-sm outline-none focus:border-[var(--t-accent)] resize-none"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                  placeholder="Additional context..."
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={confirmResolve}
                  disabled={!resolveReason || resolving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-all disabled:opacity-40"
                  style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {resolving ? "Resolving..." : "Confirm Resolution"}
                </button>
                <button
                  onClick={() => setResolveTarget(null)}
                  className="rounded-full border px-4 py-2.5 text-sm font-medium transition-colors"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
      </SlideOver>
    </div>
  );
}
