"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Shield, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/* ── Types ── */

interface AuditEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  user_id: string;
  customer_id: string | null;
  job_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditResponse {
  data: AuditEvent[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/* ── Constants ── */

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "All Events" },
  { value: "credit_hold_set", label: FEATURE_REGISTRY.credit_audit_event_hold_set?.label ?? "Hold Set" },
  { value: "credit_hold_released", label: FEATURE_REGISTRY.credit_audit_event_hold_released?.label ?? "Hold Released" },
  { value: "booking_override", label: FEATURE_REGISTRY.credit_audit_event_booking_override?.label ?? "Booking Override" },
  { value: "dispatch_override", label: FEATURE_REGISTRY.credit_audit_event_dispatch_override?.label ?? "Dispatch Override" },
  { value: "credit_policy_updated", label: FEATURE_REGISTRY.credit_audit_event_policy_updated?.label ?? "Policy Updated" },
  { value: "credit_settings_updated", label: FEATURE_REGISTRY.credit_audit_event_settings_updated?.label ?? "Settings Updated" },
];

function eventLabel(type: string): string {
  const opt = EVENT_TYPE_OPTIONS.find((o) => o.value === type);
  return opt?.label ?? type.replace(/_/g, " ");
}

function eventColor(type: string): string {
  switch (type) {
    case "credit_hold_set": return "var(--t-error)";
    case "credit_hold_released": return "var(--t-accent)";
    case "booking_override":
    case "dispatch_override": return "var(--t-warning, #F59E0B)";
    case "credit_policy_updated":
    case "credit_settings_updated": return "var(--t-info, #3B82F6)";
    default: return "var(--t-text-muted)";
  }
}

/* ── Page ── */

export default function CreditAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<AuditResponse["meta"]>({ total: 0, page: 1, limit: 25, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (eventType) params.set("eventType", eventType);
      if (customerId.trim()) params.set("customerId", customerId.trim());
      const res = await api.get<AuditResponse>(`/credit-audit/events?${params}`);
      setEvents(res.data);
      setMeta(res.meta);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [page, eventType, customerId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const title = FEATURE_REGISTRY.credit_audit_dashboard?.label ?? "Credit Control Audit";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6" style={{ color: "var(--t-accent)" }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--t-text-primary)" }}>{title}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {FEATURE_REGISTRY.credit_audit_dashboard?.shortDescription ?? "Centralized log of all credit-control actions"}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchEvents()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={eventType}
          onChange={(e) => { setEventType(e.target.value); setPage(1); }}
          className="rounded-[10px] border px-3 py-2 text-xs outline-none"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-card)" }}
        >
          {EVENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}
          placeholder={FEATURE_REGISTRY.credit_audit_filter_customer?.label ?? "Customer ID..."}
          className="rounded-[10px] border px-3 py-2 text-xs outline-none w-64"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-card)" }}
        />
        <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>
          {meta.total} event{meta.total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
        {/* Header row */}
        <div className="grid grid-cols-[140px_150px_1fr_80px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: "var(--t-text-muted)", borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-elevated, var(--t-bg-card))" }}>
          <span>{FEATURE_REGISTRY.credit_audit_col_timestamp?.label ?? "Timestamp"}</span>
          <span>{FEATURE_REGISTRY.credit_audit_col_event?.label ?? "Event"}</span>
          <span>{FEATURE_REGISTRY.credit_audit_col_summary?.label ?? "Summary"}</span>
          <span />
        </div>

        {loading && events.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>Loading...</div>
        )}

        {!loading && events.length === 0 && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>No audit events found</div>
        )}

        {events.map((ev) => {
          const expanded = expandedId === ev.id;
          return (
            <div key={ev.id} style={{ borderBottom: "1px solid var(--t-border)" }}>
              <div
                className="grid grid-cols-[140px_150px_1fr_80px] gap-3 px-4 py-3 items-center cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors"
                onClick={() => setExpandedId(expanded ? null : ev.id)}
              >
                <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>
                  {new Date(ev.created_at).toLocaleDateString()}{" "}
                  {new Date(ev.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-xs font-semibold" style={{ color: eventColor(ev.event_type) }}>
                  {eventLabel(ev.event_type)}
                </span>
                <div className="text-xs min-w-0 truncate" style={{ color: "var(--t-text-primary)" }}>
                  {ev.reason && <span>{ev.reason}</span>}
                  {!ev.reason && ev.customer_id && <span>Customer: {ev.customer_id.slice(0, 8)}...</span>}
                  {!ev.reason && !ev.customer_id && <span style={{ color: "var(--t-text-muted)" }}>—</span>}
                </div>
                <div className="flex justify-end">
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />}
                </div>
              </div>
              {expanded && (
                <div className="px-4 pb-4 pt-1 grid grid-cols-2 gap-x-6 gap-y-2 text-xs" style={{ background: "var(--t-bg-elevated, var(--t-bg-card))" }}>
                  <div><span style={{ color: "var(--t-text-muted)" }}>User ID:</span> <span className="font-mono text-[11px]" style={{ color: "var(--t-text-primary)" }}>{ev.user_id}</span></div>
                  {ev.customer_id && (
                    <div>
                      <span style={{ color: "var(--t-text-muted)" }}>Customer:</span>{" "}
                      <Link href={`/customers/${ev.customer_id}`} className="font-mono text-[11px]" style={{ color: "var(--t-accent)" }}>
                        {ev.customer_id.slice(0, 8)}...
                      </Link>
                    </div>
                  )}
                  {ev.job_id && (
                    <div>
                      <span style={{ color: "var(--t-text-muted)" }}>Job:</span>{" "}
                      <Link href={`/jobs/${ev.job_id}`} className="font-mono text-[11px]" style={{ color: "var(--t-accent)" }}>
                        {ev.job_id.slice(0, 8)}...
                      </Link>
                    </div>
                  )}
                  {ev.reason && <div className="col-span-2"><span style={{ color: "var(--t-text-muted)" }}>Reason:</span> <span style={{ color: "var(--t-text-primary)" }}>{ev.reason}</span></div>}
                  {Object.keys(ev.metadata).length > 0 && (
                    <div className="col-span-2">
                      <span style={{ color: "var(--t-text-muted)" }}>Metadata:</span>
                      <pre className="mt-1 text-[10px] font-mono p-2 rounded-lg overflow-x-auto" style={{ background: "var(--t-bg-card)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}>
                        {JSON.stringify(ev.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          >
            Prev
          </button>
          <span className="text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>
            Page {meta.page} of {meta.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
            disabled={page >= meta.totalPages}
            className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
