"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Mail, Phone, CheckCircle2, XCircle, Clock, Bell } from "lucide-react";
import { api } from "@/lib/api";

interface NotifLog {
  id: string;
  channel: string;
  type: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  external_id: string;
  error_message: string;
  sent_at: string;
  created_at: string;
  customer?: { id: string; first_name: string; last_name: string } | null;
}

const TYPE_LABELS: Record<string, string> = {
  booking_confirmation: "Booking",
  delivery_reminder: "Delivery",
  on_my_way: "On My Way",
  service_completed: "Completed",
  pickup_reminder: "Pickup",
  overdue_rental: "Overdue",
  invoice_sent: "Invoice",
  payment_received: "Payment",
  test: "Test",
};

const STATUS_COLORS: Record<string, string> = {
  delivered: "var(--t-accent)",
  sent: "var(--t-accent)",
  queued: "var(--t-text-muted)",
  pending: "var(--t-text-muted)",
  failed: "var(--t-error)",
};

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function NotificationLogPage() {
  const [logs, setLogs] = useState<NotifLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [summary, setSummary] = useState<{ total: number; breakdown: any[] }>({ total: 0, breakdown: [] });
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (typeFilter) params.set("type", typeFilter);
      if (channelFilter) params.set("channel", channelFilter);
      if (statusFilter) params.set("status", statusFilter);
      const [res, sum] = await Promise.all([
        api.get<{ data: NotifLog[]; meta: { total: number } }>(`/notifications?${params}`),
        api.get<{ total: number; breakdown: any[] }>("/notifications/log/summary"),
      ]);
      setLogs(res.data);
      setTotal(res.meta.total);
      setSummary(sum);
    } catch { /* */ } finally { setLoading(false); }
  }, [page, typeFilter, channelFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [typeFilter, channelFilter, statusFilter]);

  const emailCount = summary.breakdown.filter((r: any) => r.channel === "email" && ["delivered", "sent"].includes(r.status)).reduce((s: number, r: any) => s + Number(r.count), 0);
  const smsCount = summary.breakdown.filter((r: any) => r.channel === "sms" && ["delivered", "sent"].includes(r.status)).reduce((s: number, r: any) => s + Number(r.count), 0);
  const failedCount = summary.breakdown.filter((r: any) => r.status === "failed").reduce((s: number, r: any) => s + Number(r.count), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Notification Log</h1>
          <p className="text-sm mt-1" style={{ color: "var(--t-frame-text-muted)" }}>{summary.total} total notifications</p>
        </div>
        <Link href="/settings?tab=notifications" className="flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors" style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
          <Bell className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Sent", value: emailCount + smsCount, color: "var(--t-text-primary)" },
          { label: "Emails", value: emailCount, color: "var(--t-accent)" },
          { label: "SMS", value: smsCount, color: "#3B82F6" },
          { label: "Failed", value: failedCount, color: failedCount > 0 ? "var(--t-error)" : "var(--t-text-muted)" },
        ].map(c => (
          <div key={c.label} className="rounded-[16px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</p>
            <p className="text-[11px] font-medium" style={{ color: "var(--t-text-muted)" }}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-[14px] border px-3 py-2 text-sm outline-none" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} className="rounded-[14px] border px-3 py-2 text-sm outline-none" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <option value="">All Channels</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-[14px] border px-3 py-2 text-sm outline-none" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <option value="">All Status</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="queued">Pending</option>
        </select>
      </div>

      {/* Log */}
      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-16 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />)}</div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center py-20">
          <Bell className="h-12 w-12 mb-4" style={{ color: "var(--t-text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No notifications found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => (
            <div key={log.id}>
              <button onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                className="w-full flex items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition-colors"
                style={{ background: "var(--t-bg-card)", borderColor: expanded === log.id ? "var(--t-accent)" : "var(--t-border)" }}
                onMouseEnter={e => { if (expanded !== log.id) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--t-bg-card)"; }}>
                {log.channel === "email" ? <Mail className="h-4 w-4 shrink-0" style={{ color: "var(--t-accent)" }} /> : <Phone className="h-4 w-4 shrink-0" style={{ color: "#3B82F6" }} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>
                      {log.customer ? `${log.customer.first_name} ${log.customer.last_name}` : log.recipient}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}>
                      {TYPE_LABELS[log.type] || log.type}
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: "var(--t-text-muted)" }}>
                    {log.subject || log.body?.replace(/<[^>]*>/g, "").slice(0, 60)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium flex items-center gap-0.5 justify-end" style={{ color: STATUS_COLORS[log.status] || "var(--t-text-muted)" }}>
                    {["delivered", "sent"].includes(log.status) ? <CheckCircle2 className="h-3 w-3" /> : log.status === "failed" ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {log.status}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>{timeAgo(log.created_at)}</p>
                </div>
              </button>
              {expanded === log.id && (
                <div className="mx-4 mt-1 mb-2 rounded-[14px] border p-4 text-sm" style={{ background: "var(--t-bg-elevated)", borderColor: "var(--t-border)" }}>
                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                    <div><span style={{ color: "var(--t-text-muted)" }}>To:</span> <span style={{ color: "var(--t-text-primary)" }}>{log.recipient}</span></div>
                    <div><span style={{ color: "var(--t-text-muted)" }}>Channel:</span> <span style={{ color: "var(--t-text-primary)" }}>{log.channel}</span></div>
                    {log.external_id && <div><span style={{ color: "var(--t-text-muted)" }}>ID:</span> <span style={{ color: "var(--t-text-muted)" }}>{log.external_id}</span></div>}
                    {log.error_message && <div className="col-span-2 text-[var(--t-error)]">Error: {log.error_message}</div>}
                  </div>
                  {log.subject && <p className="font-medium mb-1" style={{ color: "var(--t-text-primary)" }}>{log.subject}</p>}
                  <div className="text-xs whitespace-pre-wrap" style={{ color: "var(--t-text-muted)" }}>{log.body?.replace(/<[^>]*>/g, "").slice(0, 500)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 25 && (
        <div className="flex items-center justify-between mt-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 25 + 1}-{Math.min(page * 25, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-full border px-4 py-1.5 disabled:opacity-30" style={{ borderColor: "var(--t-border)" }}>Prev</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total} className="rounded-full border px-4 py-1.5 disabled:opacity-30" style={{ borderColor: "var(--t-border)" }}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
