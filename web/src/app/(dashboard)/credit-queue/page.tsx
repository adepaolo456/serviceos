"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ClipboardList, Shield, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/* ── Types ── */

interface QueueCustomer {
  customer_id: string;
  customer_name: string;
  hold_status: "on_hold" | "normal";
  override_count_30d: number;
  event_count_30d: number;
  last_event_at: string | null;
  reason_summary: string;
}

interface QueueResponse {
  data: QueueCustomer[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

type CreditHoldReason =
  | { type: "manual_hold"; set_by: string | null; set_at: string | null; reason: string | null }
  | { type: "credit_limit_exceeded"; limit: number; current_ar: number }
  | { type: "overdue_threshold_exceeded"; threshold_days: number; oldest_past_due_days: number };

interface CreditState {
  receivable: { total_open_ar: number };
  past_due: { total_past_due_ar: number; oldest_past_due_days: number | null };
  hold: {
    effective_active: boolean;
    manual_active: boolean;
    policy_active: boolean;
    reasons: CreditHoldReason[];
  };
}

interface AuditEvent {
  id: string;
  event_type: string;
  reason: string | null;
  created_at: string;
}

/* ── Helpers ── */

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const fmt = (n: number) => formatCurrency(n);

/* ── Page ── */

export default function CreditQueuePage() {
  const [queue, setQueue] = useState<QueueCustomer[]>([]);
  const [meta, setMeta] = useState<QueueResponse["meta"]>({ total: 0, page: 1, limit: 25, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCredit, setDetailCredit] = useState<CreditState | null>(null);
  const [detailEvents, setDetailEvents] = useState<AuditEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<QueueResponse>(`/credit-workflow/customers?page=${page}&limit=25`);
      setQueue(res.data);
      setMeta(res.meta);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const openDetail = async (customerId: string) => {
    setSelectedId(customerId);
    setDetailCredit(null);
    setDetailEvents([]);
    setDetailLoading(true);
    try {
      const [credit, events] = await Promise.all([
        api.get<CreditState>(`/customers/${customerId}/credit-state`).catch(() => null),
        api.get<{ data: AuditEvent[] }>(`/credit-audit/events?customerId=${customerId}&limit=15`).then(r => r.data).catch(() => []),
      ]);
      setDetailCredit(credit);
      setDetailEvents(events);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => { setSelectedId(null); setDetailCredit(null); setDetailEvents([]); };

  const selected = queue.find(c => c.customer_id === selectedId) ?? null;

  const title = label("credit_queue_dashboard", "Credit Review Queue");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6" style={{ color: "var(--t-accent)" }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--t-text-primary)" }}>{title}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {FEATURE_REGISTRY.credit_queue_dashboard?.shortDescription ?? "Customers needing credit-related attention"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>{meta.total} customer{meta.total !== 1 ? "s" : ""}</span>
          <button onClick={() => fetchQueue()} disabled={loading} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Queue table */}
        <div className="flex-1 min-w-0">
          <div className="rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_70px_70px_100px_1fr] gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)", borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-elevated, var(--t-bg-card))" }}>
              <span>{label("credit_queue_col_customer", "Customer")}</span>
              <span className="text-center">{label("credit_queue_col_status", "Status")}</span>
              <span className="text-right">{label("credit_queue_col_overrides", "Overrides")}</span>
              <span className="text-right">{label("credit_queue_col_events", "Events")}</span>
              <span className="text-right">{label("credit_queue_col_last_activity", "Last Activity")}</span>
              <span>{label("credit_queue_col_reason", "Reason")}</span>
            </div>

            {loading && queue.length === 0 && (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>Loading...</div>
            )}
            {!loading && queue.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{label("credit_queue_empty_title", "Queue is clear")}</p>
                <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>{label("credit_queue_empty_desc", "No customers currently need credit review.")}</p>
              </div>
            )}

            {queue.map((c) => (
              <div
                key={c.customer_id}
                className="grid grid-cols-[1fr_80px_70px_70px_100px_1fr] gap-2 px-4 py-3 items-center cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
                style={{ borderBottom: "1px solid var(--t-border)", background: selectedId === c.customer_id ? "var(--t-accent-soft)" : undefined }}
                onClick={() => openDetail(c.customer_id)}
              >
                <span className="text-xs font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{c.customer_name}</span>
                <div className="flex justify-center">
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: c.hold_status === "on_hold" ? "var(--t-error-soft)" : "var(--t-accent-soft)",
                      color: c.hold_status === "on_hold" ? "var(--t-error)" : "var(--t-accent)",
                    }}
                  >
                    {c.hold_status === "on_hold"
                      ? label("credit_queue_status_on_hold", "On Hold")
                      : label("credit_queue_status_normal", "Active")}
                  </span>
                </div>
                <span className="text-xs text-right tabular-nums" style={{ color: c.override_count_30d > 0 ? "var(--t-warning, #F59E0B)" : "var(--t-text-muted)" }}>{c.override_count_30d}</span>
                <span className="text-xs text-right tabular-nums" style={{ color: "var(--t-text-primary)" }}>{c.event_count_30d}</span>
                <span className="text-xs text-right tabular-nums" style={{ color: "var(--t-text-muted)" }}>
                  {c.last_event_at ? new Date(c.last_event_at).toLocaleDateString() : "—"}
                </span>
                <span className="text-[11px] truncate" style={{ color: "var(--t-text-secondary)" }}>{c.reason_summary}</span>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>Prev</button>
              <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>Page {meta.page} of {meta.totalPages}</span>
              <button onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page >= meta.totalPages} className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>Next</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 shrink-0">
            <div className="rounded-[20px] border p-5 sticky top-6" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold truncate" style={{ color: "var(--t-text-primary)" }}>{selected.customer_name}</h3>
                <button onClick={closeDetail} className="p-1 rounded-lg hover:bg-[var(--t-bg-card-hover)]"><X className="h-4 w-4" style={{ color: "var(--t-text-muted)" }} /></button>
              </div>

              {detailLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />)}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Credit state summary */}
                  {detailCredit && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>Credit State</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                          background: detailCredit.hold.effective_active ? "var(--t-error-soft)" : "var(--t-accent-soft)",
                          color: detailCredit.hold.effective_active ? "var(--t-error)" : "var(--t-accent)",
                        }}>
                          {detailCredit.hold.effective_active ? "On Hold" : "No Hold"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border p-2" style={{ borderColor: "var(--t-border)" }}>
                          <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Open AR</p>
                          <p className="text-sm font-bold tabular-nums" style={{ color: "var(--t-text-primary)" }}>{fmt(detailCredit.receivable.total_open_ar)}</p>
                        </div>
                        <div className="rounded-lg border p-2" style={{ borderColor: "var(--t-border)" }}>
                          <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Past Due</p>
                          <p className="text-sm font-bold tabular-nums" style={{ color: detailCredit.past_due.total_past_due_ar > 0 ? "var(--t-error)" : "var(--t-text-primary)" }}>{fmt(detailCredit.past_due.total_past_due_ar)}</p>
                        </div>
                      </div>
                      {/* Hold reasons */}
                      {detailCredit.hold.effective_active && detailCredit.hold.reasons.length > 0 && (
                        <div className="space-y-1">
                          {detailCredit.hold.reasons.map((r, i) => {
                            if (r.type === "manual_hold") return <p key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}><span className="font-semibold">Manual hold</span>{r.reason && ` — ${r.reason}`}</p>;
                            if (r.type === "credit_limit_exceeded") return <p key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}><span className="font-semibold">Credit limit</span> — {fmt(r.current_ar)} / {fmt(r.limit)}</p>;
                            if (r.type === "overdue_threshold_exceeded") return <p key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}><span className="font-semibold">Past due</span> — {r.oldest_past_due_days}d (threshold: {r.threshold_days}d)</p>;
                            return null;
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recent audit events */}
                  {detailEvents.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--t-text-muted)" }}>Recent Activity</p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {detailEvents.map((ev) => (
                          <div key={ev.id} className="text-[11px] flex gap-2">
                            <span className="tabular-nums shrink-0" style={{ color: "var(--t-text-muted)" }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                            <span style={{ color: "var(--t-text-primary)" }}>{ev.event_type.replace(/_/g, " ")}{ev.reason ? ` — ${ev.reason}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid var(--t-border)" }}>
                    <Link href={`/customers/${selected.customer_id}`} className="flex items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-medium" style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>
                      <ExternalLink className="h-3 w-3" /> {label("credit_queue_view_customer", "View Customer")}
                    </Link>
                    <Link href={`/credit-audit?customerId=${selected.customer_id}`} className="flex items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-medium" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                      <Shield className="h-3 w-3" /> {label("credit_queue_view_audit", "View Audit Log")}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
