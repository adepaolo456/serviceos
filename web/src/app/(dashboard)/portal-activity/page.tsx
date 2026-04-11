"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Globe, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

interface PortalJob {
  id: string;
  job_number: string;
  job_type: string;
  status: string;
  asset_subtype: string | null;
  scheduled_date: string;
  total_price: number;
  created_at: string;
  customer_id: string;
  customer_name: string | null;
  payment_status: "paid" | "awaiting_payment" | "no_invoice";
  is_net_terms: boolean;
  balance_due: number;
}

interface Summary {
  total: number;
  today: number;
  awaiting_payment: number;
  paid_ready: number;
}

const FILTERS = [
  { key: "", label: "portal_activity_filter_all", fallback: "All" },
  { key: "awaiting_payment", label: "portal_activity_filter_awaiting", fallback: "Awaiting Payment" },
  { key: "paid_ready", label: "portal_activity_filter_paid", fallback: "Paid / Ready" },
  { key: "net_terms", label: "portal_activity_filter_net_terms", fallback: "Net Terms" },
];

const PAYMENT_COLORS: Record<string, { bg: string; color: string }> = {
  paid: { bg: "var(--t-accent-soft)", color: "var(--t-accent)" },
  awaiting_payment: { bg: "var(--t-warning-soft, #FFF8E1)", color: "var(--t-warning, #F59E0B)" },
  no_invoice: { bg: "var(--t-bg-elevated)", color: "var(--t-text-muted)" },
};

const PAYMENT_LABELS: Record<string, { id: string; fallback: string }> = {
  paid: { id: "portal_activity_status_paid", fallback: "Paid" },
  awaiting_payment: { id: "portal_activity_status_awaiting", fallback: "Awaiting Payment" },
  no_invoice: { id: "portal_activity_status_no_invoice", fallback: "Pending" },
};

export default function PortalActivityPage() {
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 25, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (filter) params.set("filter", filter);
      const [s, j] = await Promise.all([
        api.get<Summary>("/portal-activity/summary").catch(() => null),
        api.get<{ data: PortalJob[]; meta: typeof meta }>(`/portal-activity/jobs?${params}`),
      ]);
      setSummary(s);
      setJobs(j.data);
      setMeta(j.meta);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Globe className="h-6 w-6" style={{ color: "var(--t-accent)" }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--t-text-primary)" }}>{label("portal_activity_title", "Portal Activity")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>{label("portal_activity_subtitle", "Customer requests from the self-service portal")}</p>
          </div>
        </div>
        <button onClick={() => fetchData()} disabled={loading} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> {label("ui_refresh", "Refresh")}
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label={label("portal_activity_metric_today", "Today")} value={summary.today} color="var(--t-accent)" />
          <MetricCard label={label("portal_activity_metric_awaiting", "Awaiting Payment")} value={summary.awaiting_payment} color="var(--t-warning, #F59E0B)" />
          <MetricCard label={label("portal_activity_metric_paid", "Paid / Ready")} value={summary.paid_ready} color="var(--t-accent)" />
          <MetricCard label={label("portal_activity_metric_total", "Total Active")} value={summary.total} color="var(--t-text-primary)" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center mb-4 flex-wrap">
        <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 18, border: "none", cursor: "pointer", transition: "all 0.15s ease", backgroundColor: filter === f.key ? "var(--t-accent)" : "transparent", color: filter === f.key ? "#fff" : "var(--t-text-muted)" }}>
              {label(f.label, f.fallback)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
        <div className="grid grid-cols-[1fr_100px_90px_90px_100px_80px] gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)", borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-elevated, var(--t-bg-card))" }}>
          <span>{label("portal_activity_col_customer", "Customer")}</span>
          <span>{label("portal_activity_col_size", "Size")}</span>
          <span>{label("portal_activity_col_date", "Delivery")}</span>
          <span className="text-right">{label("portal_activity_col_total", "Total")}</span>
          <span className="text-center">{label("portal_activity_col_payment", "Payment")}</span>
          <span>{label("portal_activity_col_origin", "Origin")}</span>
        </div>

        {loading && jobs.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>{label("ui_loading", "Loading...")}</div>
        )}
        {!loading && jobs.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{label("portal_activity_empty", "No portal requests")}</p>
          </div>
        )}

        {jobs.map(j => {
          const ps = PAYMENT_COLORS[j.payment_status] || PAYMENT_COLORS.no_invoice;
          const pl = PAYMENT_LABELS[j.payment_status] || PAYMENT_LABELS.no_invoice;
          return (
            <Link key={j.id} href={`/jobs/${j.id}`}
              className="grid grid-cols-[1fr_100px_90px_90px_100px_80px] gap-2 px-4 py-3 items-center hover:bg-[var(--t-bg-card-hover)] transition-colors"
              style={{ borderBottom: "1px solid var(--t-border)" }}>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{j.customer_name || j.job_number}</p>
                {j.is_net_terms && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--t-info-soft, #EFF6FF)", color: "var(--t-info, #3B82F6)" }}>{label("portal_activity_net_terms", "Net Terms")}</span>}
              </div>
              <span className="text-xs font-bold" style={{ color: "var(--t-text-primary)" }}>{j.asset_subtype || "—"}</span>
              <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>{j.scheduled_date ? new Date(j.scheduled_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</span>
              <span className="text-xs text-right tabular-nums font-medium" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(j.total_price)}</span>
              <div className="flex justify-center">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: ps.bg, color: ps.color }}>
                  {label(pl.id, pl.fallback)}
                </span>
              </div>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                {label("portal_activity_origin_badge", "Portal")}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>{label("ui_prev", "Prev")}</button>
          <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>{meta.page} / {meta.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page >= meta.totalPages} className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>{label("ui_next", "Next")}</button>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label: cardLabel, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>{cardLabel}</p>
      <p className="text-2xl font-bold tabular-nums mt-1" style={{ color }}>{value}</p>
    </div>
  );
}
