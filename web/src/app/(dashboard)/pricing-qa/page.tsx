"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield, Lock, RefreshCw, ArrowLeftRight, MapPinOff, FileX, Eye,
  AlertTriangle, Info, CheckCircle2, ExternalLink, Copy, X, MapPin,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import QuickView from "@/components/quick-view";

/* ── Types ── */

interface PricingQaRow {
  job_id: string;
  job_number: string;
  customer_name: string;
  service_address_summary: string;
  status: string;
  job_type: string;
  asset_subtype: string | null;
  issue_type: string;
  severity: "critical" | "warning" | "info";
  has_locked_snapshot: boolean;
  pricing_snapshot_id: string | null;
  pricing_config_version_id: string | null;
  pricing_locked_at: string | null;
  last_recalculation_reasons: string[] | null;
  is_exchange: boolean;
  exchange_pickup_subtype: string | null;
  exchange_dropoff_subtype: string | null;
  has_valid_coordinates: boolean;
  geocode_blocked: boolean;
  invoice_id: string | null;
  invoice_status: string | null;
  created_at: string;
  updated_at: string;
}

interface Summary {
  total_jobs: number;
  locked_snapshots: number;
  recalculations: number;
  exchange_jobs: number;
  geocode_blocked: number;
  missing_address: number;
  missing_snapshots: number;
}

interface ReviewQueueItem {
  record_type: string;
  record_id: string;
  address: string | null;
  last_geocode_attempt: string | null;
}

interface AuditEntry {
  id: string;
  job_id: string;
  recalculation_reasons: string[];
  previous_pricing_snapshot_id: string | null;
  new_pricing_snapshot_id: string | null;
  created_at: string;
}

/* ── Issue config ── */

const ISSUE_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  geocode_blocked: { label: "Geocode Blocked", icon: MapPinOff, color: "var(--t-error)" },
  missing_address: { label: "Missing Address", icon: MapPinOff, color: "var(--t-error)" },
  pricing_snapshot_missing: { label: "No Snapshot", icon: FileX, color: "var(--t-warning)" },
  pricing_locked_snapshot: { label: "Locked", icon: Lock, color: "var(--t-accent)" },
  pricing_recalculated: { label: "Recalculated", icon: RefreshCw, color: "var(--t-info)" },
  exchange_job: { label: "Exchange", icon: ArrowLeftRight, color: "#a78bfa" },
};

const SEVERITY_CONFIG = {
  critical: { label: "Critical", bg: "var(--t-error-soft)", color: "var(--t-error)", icon: AlertTriangle },
  warning: { label: "Warning", bg: "var(--t-warning-soft)", color: "var(--t-warning)", icon: AlertTriangle },
  info: { label: "Info", bg: "var(--t-info-soft)", color: "var(--t-info)", icon: Info },
};

const STAT_CARDS = [
  { key: "geocode_blocked", label: "Geocode Blocked", color: "var(--t-error)", field: "geocode_blocked" as const },
  { key: "missing_address", label: "Missing Address", color: "var(--t-error)", field: "missing_address" as const },
  { key: "missing_snapshots", label: "No Snapshot", color: "var(--t-warning)", field: "missing_snapshots" as const },
  { key: "exchange_jobs", label: "Exchange Jobs", color: "#a78bfa", field: "exchange_jobs" as const },
  { key: "recalculations", label: "Recalculated", color: "var(--t-info)", field: "recalculations" as const },
  { key: "locked_snapshots", label: "Locked", color: "var(--t-accent)", field: "locked_snapshots" as const },
];

/* ── Page ── */

export default function PricingQaPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<PricingQaRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<PricingQaRow[]>([]);
  const [issueFilter, setIssueFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [selectedRow, setSelectedRow] = useState<PricingQaRow | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [qaData, queue] = await Promise.all([
        api.get<{ summary: Summary; rows: PricingQaRow[] }>("/pricing-qa/overview"),
        api.get<ReviewQueueItem[]>("/geocoding/review-queue?limit=50"),
      ]);
      setSummary(qaData.summary);
      setRows(qaData.rows);
      setFilteredRows(qaData.rows);
      setReviewQueue(queue);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Apply filters
  useEffect(() => {
    let result = rows;
    if (issueFilter) result = result.filter(r => r.issue_type === issueFilter);
    if (severityFilter) result = result.filter(r => r.severity === severityFilter);
    setFilteredRows(result);
  }, [rows, issueFilter, severityFilter]);

  const openDetail = async (row: PricingQaRow) => {
    setSelectedRow(row);
    setAuditLoading(true);
    try {
      const history = await api.get<AuditEntry[]>(`/pricing-qa/audit-history?jobId=${row.job_id}`);
      setAuditHistory(history);
    } catch { setAuditHistory([]); }
    finally { setAuditLoading(false); }
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => toast("success", "Copied"));
  };

  const getIssueInfo = (type: string) => ISSUE_CONFIG[type] || { label: type, icon: Shield, color: "var(--t-text-muted)" };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Pricing QA</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">
            {summary ? `${summary.total_jobs} jobs · ${summary.geocode_blocked + summary.missing_address} blockers` : "Loading..."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={fetchData} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all"
            style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link href="/billing-issues"
            className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all"
            style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
            Billing Issues <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {STAT_CARDS.map(s => {
            const count = summary[s.field];
            const active = issueFilter === s.key;
            return (
              <button key={s.key}
                onClick={() => setIssueFilter(active ? "" : s.key)}
                className={`rounded-[16px] border p-3 text-left transition-all ${active ? "ring-2 ring-[var(--t-accent)]" : ""}`}
                style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                <p className="text-lg font-bold tabular-nums" style={{ color: count > 0 ? s.color : "var(--t-text-muted)" }}>
                  {count}
                </p>
                <p className="text-[11px] font-medium" style={{ color: "var(--t-text-muted)" }}>{s.label}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select value={issueFilter} onChange={e => setIssueFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <option value="">All Issue Types</option>
          {Object.entries(ISSUE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {(issueFilter || severityFilter) && (
          <button onClick={() => { setIssueFilter(""); setSeverityFilter(""); }}
            className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">Clear Filters</button>
        )}
        <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--t-text-muted)" }}>
          {filteredRows.length} result{filteredRows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton rounded-[14px]" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle2 className="h-12 w-12 mb-4" style={{ color: "var(--t-accent)" }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--t-frame-text)" }}>All clear</h3>
          <p className="text-sm" style={{ color: "var(--t-frame-text-muted)" }}>No pricing issues found for this filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                {["Severity", "Job #", "Customer", "Type", "Status", "Address", "Pricing", "Version", "Updated"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
                    style={{ color: "var(--t-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const issue = getIssueInfo(row.issue_type);
                const sev = SEVERITY_CONFIG[row.severity];
                return (
                  <tr key={row.job_id} className="table-row cursor-pointer" onClick={() => openDetail(row)}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: sev.bg, color: sev.color }}>
                        <sev.icon className="h-3 w-3" /> {sev.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{row.job_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{row.customer_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--t-bg-elevated)", color: issue.color }}>
                        <issue.icon className="h-3 w-3" /> {issue.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs capitalize" style={{ color: "var(--t-text-muted)" }}>{row.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 max-w-[180px]">
                        {!row.has_valid_coordinates && <MapPinOff className="h-3 w-3 shrink-0" style={{ color: "var(--t-error)" }} />}
                        <span className="text-xs truncate" style={{ color: row.has_valid_coordinates ? "var(--t-text-muted)" : "var(--t-error)" }}>
                          {row.service_address_summary}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.has_locked_snapshot ? (
                        <Lock className="h-3.5 w-3.5" style={{ color: "var(--t-accent)" }} />
                      ) : (
                        <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono truncate max-w-[80px] inline-block"
                        style={{ color: "var(--t-text-muted)" }}>
                        {row.pricing_config_version_id?.slice(0, 8) || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                        {new Date(row.updated_at).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Geocoding Review Queue */}
      {reviewQueue.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[17px] font-bold tracking-[-0.3px] mb-3" style={{ color: "var(--t-frame-text)" }}>
            <MapPin className="h-4 w-4 inline mr-1.5" style={{ color: "var(--t-error)" }} />
            Needs Address Resolution ({reviewQueue.length})
          </h2>
          <div className="space-y-2">
            {reviewQueue.map(item => (
              <div key={item.record_id}
                className="flex items-center gap-4 rounded-[14px] border p-3"
                style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", borderLeftWidth: 3, borderLeftColor: "var(--t-error)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>
                      {item.record_type}
                    </span>
                    <span className="text-xs font-mono" style={{ color: "var(--t-text-muted)" }}>{item.record_id.slice(0, 12)}...</span>
                  </div>
                  <p className="text-sm" style={{ color: item.address ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                    {item.address || "No address on record"}
                  </p>
                  {item.last_geocode_attempt && (
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                      Last attempt: {new Date(item.last_geocode_attempt).toLocaleString()}
                    </p>
                  )}
                </div>
                <Link href={item.record_type === "job" ? `/jobs/${item.record_id}` : `/customers/${item.record_id}`}
                  className="shrink-0 text-xs font-medium rounded-full border px-3 py-1.5 transition-colors"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
                  Edit <ExternalLink className="h-3 w-3 inline ml-1" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      <QuickView
        isOpen={!!selectedRow}
        onClose={() => { setSelectedRow(null); setAuditHistory([]); }}
        title={selectedRow?.job_number || ""}
        subtitle={selectedRow?.customer_name}
        actions={selectedRow ? (
          <Link href={`/jobs/${selectedRow.job_id}`} className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}>
            <ExternalLink className="h-3 w-3 inline mr-1" />Full Detail
          </Link>
        ) : undefined}
      >
        {selectedRow && (
          <div className="space-y-4">
            {/* Severity + Issue */}
            <div className="flex items-center gap-2 flex-wrap">
              {(() => { const s = SEVERITY_CONFIG[selectedRow.severity]; return (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
                  <s.icon className="h-3 w-3" /> {s.label}
                </span>
              ); })()}
              {(() => { const i = getIssueInfo(selectedRow.issue_type); return (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--t-bg-elevated)", color: i.color }}>
                  <i.icon className="h-3 w-3" /> {i.label}
                </span>
              ); })()}
              <span className="text-xs capitalize" style={{ color: "var(--t-text-muted)" }}>{selectedRow.status}</span>
            </div>

            {/* Job Info */}
            <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Job</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Type</span><span style={{ color: "var(--t-text-primary)" }}>{selectedRow.job_type} {selectedRow.asset_subtype || ""}</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Address</span><span className="text-right max-w-[200px] truncate" style={{ color: selectedRow.has_valid_coordinates ? "var(--t-text-primary)" : "var(--t-error)" }}>{selectedRow.service_address_summary}</span></div>
                {selectedRow.invoice_id && (
                  <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Invoice</span><Link href={`/invoices/${selectedRow.invoice_id}`} className="text-xs" style={{ color: "var(--t-accent)" }}>{selectedRow.invoice_status} →</Link></div>
                )}
              </div>
            </div>

            {/* Pricing State */}
            <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Pricing State</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Locked Snapshot</span><span style={{ color: selectedRow.has_locked_snapshot ? "var(--t-accent)" : "var(--t-text-muted)" }}>{selectedRow.has_locked_snapshot ? "Yes" : "No"}</span></div>
                {selectedRow.pricing_locked_at && (
                  <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Locked At</span><span style={{ color: "var(--t-text-primary)" }}>{new Date(selectedRow.pricing_locked_at).toLocaleString()}</span></div>
                )}
                {selectedRow.pricing_snapshot_id && (
                  <div className="flex justify-between items-center"><span style={{ color: "var(--t-text-muted)" }}>Snapshot ID</span>
                    <button onClick={() => copyId(selectedRow.pricing_snapshot_id!)} className="flex items-center gap-1 text-xs font-mono" style={{ color: "var(--t-text-muted)" }}>
                      {selectedRow.pricing_snapshot_id.slice(0, 12)}... <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {selectedRow.pricing_config_version_id && (
                  <div className="flex justify-between items-center"><span style={{ color: "var(--t-text-muted)" }}>Config Version</span>
                    <button onClick={() => copyId(selectedRow.pricing_config_version_id!)} className="flex items-center gap-1 text-xs font-mono" style={{ color: "var(--t-text-muted)" }}>
                      {selectedRow.pricing_config_version_id.slice(0, 12)}... <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Exchange Info */}
            {selectedRow.is_exchange && (
              <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--t-border)" }}>
                <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#a78bfa" }}>Exchange Details</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Pickup</span><span style={{ color: "var(--t-text-primary)" }}>{selectedRow.exchange_pickup_subtype || "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Dropoff</span><span style={{ color: "var(--t-text-primary)" }}>{selectedRow.exchange_dropoff_subtype || "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Tonnage Source</span><span style={{ color: "var(--t-warning)" }}>Pickup container</span></div>
                </div>
              </div>
            )}

            {/* Geocoding */}
            <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Geocoding</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Valid Coordinates</span>
                  <span style={{ color: selectedRow.has_valid_coordinates ? "var(--t-accent)" : "var(--t-error)" }}>
                    {selectedRow.has_valid_coordinates ? "Yes" : "No"}
                  </span>
                </div>
                {selectedRow.geocode_blocked && (
                  <p className="text-xs mt-1" style={{ color: "var(--t-error)" }}>
                    Pricing blocked — address needs geocoding before distance calculation
                  </p>
                )}
              </div>
            </div>

            {/* Audit History */}
            <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Recalculation History</p>
              {auditLoading ? (
                <div className="h-12 skeleton rounded-lg" />
              ) : auditHistory.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--t-text-tertiary)" }}>No recalculations recorded</p>
              ) : (
                <div className="space-y-2">
                  {auditHistory.map(a => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <RefreshCw className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "var(--t-info)" }} />
                      <div>
                        <p style={{ color: "var(--t-text-primary)" }}>{a.recalculation_reasons.join(", ")}</p>
                        <p style={{ color: "var(--t-text-muted)" }}>{new Date(a.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Links */}
            <div className="flex gap-2 flex-wrap">
              <Link href={`/jobs/${selectedRow.job_id}`} className="text-xs font-medium rounded-full border px-3 py-1.5"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>Open Job</Link>
              {selectedRow.invoice_id && (
                <Link href={`/invoices/${selectedRow.invoice_id}`} className="text-xs font-medium rounded-full border px-3 py-1.5"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>Open Invoice</Link>
              )}
            </div>
          </div>
        )}
      </QuickView>
    </div>
  );
}
