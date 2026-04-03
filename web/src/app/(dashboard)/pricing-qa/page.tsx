"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Shield, Lock, RefreshCw, ArrowLeftRight, MapPinOff, FileX, Eye,
  AlertTriangle, Info, CheckCircle2, ExternalLink, Copy, X, MapPin,
  ChevronRight, Zap, Pencil, Square, CheckSquare,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import QuickView from "@/components/quick-view";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

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
  can_generate_snapshot: boolean;
  can_fix_address: boolean;
  can_change_subtype: boolean;
  has_pricing_rule: boolean;
  supported_subtypes: string[];
  action_blockers: string[];
}

interface Summary {
  total_jobs: number;
  locked_snapshots: number;
  recalculations: number;
  exchange_jobs: number;
  geocode_blocked: number;
  missing_address: number;
  missing_snapshots: number;
  missing_pricing_rules: number;
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
  missing_pricing_rule: { label: "No Pricing Rule", icon: FileX, color: "var(--t-error)" },
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
  { key: "missing_pricing_rules", label: "No Pricing Rule", color: "var(--t-error)", field: "missing_pricing_rules" as const },
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const { toast } = useToast();

  // Single snapshot generation
  const handleGenerateSnapshot = async (jobId: string) => {
    setGeneratingId(jobId);
    try {
      const result = await api.post<{ status: string; reason?: string; snapshot_id?: string; job_number: string }>(`/pricing-qa/generate-snapshot/${jobId}`);
      if (result.status === "success") {
        toast("success", `Snapshot generated for ${result.job_number}`);
        await fetchData();
      } else {
        toast("error", `${result.job_number}: ${(result.reason || "failed").replace(/_/g, " ")}`);
      }
    } catch { toast("error", "Failed to generate snapshot"); }
    finally { setGeneratingId(null); }
  };

  // Bulk snapshot generation
  const handleBulkGenerate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkRunning(true);
    try {
      const result = await api.post<{
        success_count: number; failed_count: number; skipped_count: number;
        results: Array<{ job_id: string; job_number: string; status: string; reason?: string }>;
      }>("/pricing-qa/generate-snapshots-bulk", { job_ids: ids });
      const msg = `${result.success_count} generated, ${result.skipped_count} skipped, ${result.failed_count} failed`;
      toast(result.failed_count > 0 ? "warning" : "success", msg);
      setSelectedIds(new Set());
      await fetchData();
    } catch { toast("error", "Bulk generation failed"); }
    finally { setBulkRunning(false); }
  };

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllEligible = () => {
    const eligible = filteredRows.filter(r => r.can_generate_snapshot).map(r => r.job_id);
    setSelectedIds(new Set(eligible));
  };

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

  const refreshAfterPanelAction = useCallback(async (jobId: string): Promise<"resolved" | "updated"> => {
    await fetchData();
    try {
      const freshData = await api.get<{ rows: PricingQaRow[] }>("/pricing-qa/overview");
      const updated = freshData.rows.find(r => r.job_id === jobId);
      if (updated) {
        // Row still has issues — keep panel open with updated data
        setSelectedRow(updated);
        return "updated";
      } else {
        // Row fully resolved — no longer in QA result set
        // Auto-close after brief success moment
        setTimeout(() => { setSelectedRow(null); setAuditHistory([]); }, 1000);
        return "resolved";
      }
    } catch {
      return "updated";
    }
  }, [fetchData]);

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
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 mb-2 rounded-[14px] border"
              style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)" }}>
              <CheckSquare className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
              <span className="text-xs font-bold" style={{ color: "var(--t-accent)" }}>{selectedIds.size} selected</span>
              <button onClick={handleBulkGenerate} disabled={bulkRunning}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                <Zap className={`h-3 w-3 ${bulkRunning ? "animate-spin" : ""}`} />
                {bulkRunning ? "Generating..." : "Generate Snapshots"}
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto p-1 rounded" style={{ color: "var(--t-text-muted)" }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="w-10 px-3 py-2.5">
                  <button onClick={selectAllEligible} title="Select all eligible"
                    className="flex items-center justify-center w-4 h-4 rounded border transition-all"
                    style={{ borderColor: "var(--t-border-strong)", background: selectedIds.size > 0 ? "var(--t-accent)" : "transparent", color: selectedIds.size > 0 ? "var(--t-accent-on-accent)" : "transparent" }}>
                    {selectedIds.size > 0 && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                </th>
                {["Severity", "Job #", "Customer", "Type", "Address", "Pricing", "Actions"].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
                    style={{ color: "var(--t-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const issue = getIssueInfo(row.issue_type);
                const sev = SEVERITY_CONFIG[row.severity];
                const isSelected = selectedIds.has(row.job_id);
                const isGenerating = generatingId === row.job_id;
                return (
                  <tr key={row.job_id} className="table-row cursor-pointer" onClick={() => openDetail(row)}>
                    {/* Checkbox */}
                    <td className="w-10 px-3 py-3" onClick={e => e.stopPropagation()}>
                      {row.can_generate_snapshot ? (
                        <button onClick={() => toggleSelect(row.job_id)}
                          className="flex items-center justify-center w-4 h-4 rounded border transition-all"
                          style={{ borderColor: isSelected ? "var(--t-accent)" : "var(--t-border-strong)", background: isSelected ? "var(--t-accent)" : "transparent", color: isSelected ? "var(--t-accent-on-accent)" : "transparent" }}>
                          {isSelected && <CheckCircle2 className="h-3 w-3" />}
                        </button>
                      ) : (
                        <span className="w-4 h-4 block" />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: sev.bg, color: sev.color }}>
                        <sev.icon className="h-3 w-3" /> {sev.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{row.job_number}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{row.customer_name}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--t-bg-elevated)", color: issue.color }}>
                        <issue.icon className="h-3 w-3" /> {issue.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 max-w-[160px]">
                        {!row.has_valid_coordinates && <MapPinOff className="h-3 w-3 shrink-0" style={{ color: "var(--t-error)" }} />}
                        <span className="text-xs truncate" style={{ color: row.has_valid_coordinates ? "var(--t-text-muted)" : "var(--t-error)" }}>
                          {row.service_address_summary}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {row.has_locked_snapshot ? (
                        <Lock className="h-3.5 w-3.5" style={{ color: "var(--t-accent)" }} />
                      ) : (
                        <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>—</span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {row.can_generate_snapshot && (
                          <button onClick={() => handleGenerateSnapshot(row.job_id)} disabled={isGenerating}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-all disabled:opacity-50"
                            style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                            title="Generate pricing snapshot">
                            <Zap className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
                            {isGenerating ? "..." : "Snapshot"}
                          </button>
                        )}
                        {row.can_fix_address && (
                          <Link href={`/jobs/${row.job_id}`}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium"
                            style={{ borderColor: "var(--t-warning)", color: "var(--t-warning)" }}
                            title="Fix address">
                            <Pencil className="h-3 w-3" /> Address
                          </Link>
                        )}
                        {!row.can_generate_snapshot && !row.can_fix_address && (
                          <Link href={`/jobs/${row.job_id}`} className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
                            Open <ExternalLink className="h-3 w-3 inline" />
                          </Link>
                        )}
                      </div>
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

      {/* Issue Resolution Panel */}
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
          <PanelContent
            row={selectedRow}
            auditHistory={auditHistory}
            auditLoading={auditLoading}
            onRefresh={refreshAfterPanelAction}
            onCopyId={copyId}
          />
        )}
      </QuickView>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Panel Content — Resolution Checklist
   All editing state is LOCAL to prevent parent re-renders from
   interrupting typing or resetting form fields.
   ═══════════════════════════════════════════════════ */

function PanelContent({ row, auditHistory, auditLoading, onRefresh, onCopyId }: {
  row: PricingQaRow;
  auditHistory: AuditEntry[];
  auditLoading: boolean;
  onRefresh: (jobId: string) => Promise<"resolved" | "updated">;
  onCopyId: (id: string) => void;
}) {
  const { toast } = useToast();
  const sev = SEVERITY_CONFIG[row.severity];
  const issue = ISSUE_CONFIG[row.issue_type] || { label: row.issue_type, icon: Shield, color: "var(--t-text-muted)" };
  const [resolved, setResolved] = useState(false);

  // ── ALL editing state is local — parent re-renders cannot reset it ──
  const [addrDraft, setAddrDraft] = useState({
    street: "", city: "", state: "", zip: "",
  });
  const [saving, setSaving] = useState(false);
  const [geoStatus, setGeoStatus] = useState<{ status: string; reason?: string } | null>(null);
  const [snapStatus, setSnapStatus] = useState<{ status: string; reason?: string } | null>(null);
  const draftInitRef = useRef<string | null>(null);

  // Initialize draft ONCE per job_id, not on every render
  useEffect(() => {
    if (row.job_id !== draftInitRef.current) {
      draftInitRef.current = row.job_id;
      const parts = row.service_address_summary.split(", ");
      setAddrDraft({
        street: parts[0] === "No address" ? "" : parts[0] || "",
        city: parts[1] || "",
        state: parts[2] || "",
        zip: "",
      });
      setGeoStatus(null);
      setSnapStatus(null);
    }
  }, [row.job_id, row.service_address_summary]);

  // Handle autocomplete selection — populates all fields at once
  const handleAutocompleteSelect = (addr: AddressValue) => {
    setAddrDraft({
      street: addr.street || "",
      city: addr.city || "",
      state: addr.state || "",
      zip: addr.zip || "",
    });
  };

  const handleSaveAddress = async () => {
    setSaving(true);
    setGeoStatus(null);
    setSnapStatus(null);
    try {
      const result = await api.patch<{ status: string; has_valid_coordinates: boolean; can_generate_snapshot: boolean; geocode: { status: string } | null }>(`/pricing-qa/update-address/${row.job_id}`, { ...addrDraft, geocode: true });
      if (result.geocode?.status === "success") {
        setGeoStatus({ status: "success" });
        toast("success", "Address saved and geocoded");
      } else if (result.geocode?.status === "failed") {
        setGeoStatus({ status: "failed", reason: "Geocoding failed for this address" });
        toast("warning", "Address saved but geocoding failed");
      } else {
        toast("success", "Address saved");
      }
      draftInitRef.current = null;
      const outcome = await onRefresh(row.job_id);
      if (outcome === "resolved") { setResolved(true); toast("success", "Issue fully resolved"); }
    } catch { toast("error", "Failed to save address"); }
    finally { setSaving(false); }
  };

  const handleRetryGeocode = async () => {
    setGeoStatus(null);
    try {
      const result = await api.post<{ status: string; reason?: string }>(`/pricing-qa/retry-geocode/${row.job_id}`);
      setGeoStatus(result);
      if (result.status === "success") {
        toast("success", "Geocoding succeeded");
        draftInitRef.current = null;
        await onRefresh(row.job_id);
      } else {
        toast("error", `Geocoding failed: ${(result.reason || "unknown").replace(/_/g, " ")}`);
      }
    } catch { toast("error", "Geocoding request failed"); }
  };

  const handleGenerateSnapshot = async () => {
    setSnapStatus(null);
    try {
      const result = await api.post<{ status: string; reason?: string; snapshot_id?: string }>(`/pricing-qa/generate-snapshot/${row.job_id}`);
      setSnapStatus(result);
      if (result.status === "success") {
        toast("success", "Snapshot generated");
        draftInitRef.current = null;
        const outcome = await onRefresh(row.job_id);
        if (outcome === "resolved") { setResolved(true); toast("success", "Issue fully resolved"); }
      } else {
        toast("error", `Snapshot failed: ${(result.reason || "failed").replace(/_/g, " ")}`);
      }
    } catch { toast("error", "Snapshot generation failed"); }
  };

  // Change dumpster size
  const [selectedSubtype, setSelectedSubtype] = useState(row.asset_subtype || "");
  const [changingSub, setChangingSub] = useState(false);

  const handleChangeSubtype = async () => {
    if (!selectedSubtype || selectedSubtype === row.asset_subtype) return;
    setChangingSub(true);
    try {
      const result = await api.patch<{ status: string; reason?: string }>(`/pricing-qa/change-subtype/${row.job_id}`, { asset_subtype: selectedSubtype });
      if (result.status === "saved") {
        toast("success", `Changed to ${selectedSubtype}`);
        draftInitRef.current = null;
        const outcome = await onRefresh(row.job_id);
        if (outcome === "resolved") { setResolved(true); toast("success", "Issue fully resolved"); }
      } else {
        toast("error", `Failed: ${(result.reason || "unknown").replace(/_/g, " ")}`);
      }
    } catch { toast("error", "Failed to change subtype"); }
    finally { setChangingSub(false); }
  };

  const CheckItem = ({ label, done, blocked, blockerText, children }: { label: string; done: boolean; blocked?: boolean; blockerText?: string; children?: React.ReactNode }) => (
    <div className="rounded-[12px] border p-3" style={{ borderColor: done ? "var(--t-accent)" : blocked ? "var(--t-border)" : "var(--t-warning)", borderLeftWidth: 3, borderLeftColor: done ? "var(--t-accent)" : blocked ? "var(--t-text-muted)" : "var(--t-warning)", background: "var(--t-bg-card)" }}>
      <div className="flex items-center gap-2 mb-1">
        {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t-accent)" }} />
              : blocked ? <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t-text-muted)" }} />
              : <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t-warning)" }} />}
        <span className="text-xs font-semibold" style={{ color: done ? "var(--t-accent)" : "var(--t-text-primary)" }}>{label}</span>
        {done && <span className="text-[10px] ml-auto" style={{ color: "var(--t-accent)" }}>Done</span>}
        {blocked && blockerText && <span className="text-[10px] ml-auto" style={{ color: "var(--t-text-muted)" }}>{blockerText}</span>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Resolved banner */}
      {resolved && (
        <div className="rounded-[14px] px-4 py-3 flex items-center gap-2" style={{ background: "var(--t-accent-soft)", border: "1px solid var(--t-accent)" }}>
          <CheckCircle2 className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--t-accent)" }}>Issue Resolved</p>
            <p className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>Closing panel...</p>
          </div>
        </div>
      )}

      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: sev.bg, color: sev.color }}>
          <sev.icon className="h-3 w-3" /> {sev.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--t-bg-elevated)", color: issue.color }}>
          <issue.icon className="h-3 w-3" /> {issue.label}
        </span>
        <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>{row.job_type} {row.asset_subtype || ""} · {row.status}</span>
      </div>

      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>Resolution Checklist</p>

      {/* 1. Address — with Mapbox autocomplete */}
      <CheckItem label="Service Address" done={!row.can_fix_address && row.service_address_summary !== "No address"} blocked={false}>
        {row.can_fix_address ? (
          <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
            {/* Autocomplete for street — populates all fields on selection */}
            <AddressAutocomplete
              value={{ street: addrDraft.street, city: addrDraft.city, state: addrDraft.state, zip: addrDraft.zip, lat: null, lng: null }}
              onChange={handleAutocompleteSelect}
              placeholder="Search address..."
              className="w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            />
            {/* Manual field overrides */}
            <div className="grid grid-cols-2 gap-2">
              <input value={addrDraft.city} onChange={e => setAddrDraft(d => ({ ...d, city: e.target.value }))}
                placeholder="City" className="rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }} />
              <div className="flex gap-2">
                <input value={addrDraft.state} onChange={e => setAddrDraft(d => ({ ...d, state: e.target.value }))}
                  placeholder="State" className="w-16 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }} />
                <input value={addrDraft.zip} onChange={e => setAddrDraft(d => ({ ...d, zip: e.target.value }))}
                  placeholder="ZIP" className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }} />
              </div>
            </div>
            <button onClick={handleSaveAddress} disabled={saving || !addrDraft.street}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
              {saving ? "Saving..." : "Save & Geocode"}
            </button>
          </div>
        ) : (
          <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>{row.service_address_summary}</p>
        )}
      </CheckItem>

      {/* 2. Coordinates */}
      <CheckItem
        label="Coordinates"
        done={row.has_valid_coordinates}
        blocked={!row.service_address_summary || row.service_address_summary === "No address"}
        blockerText={row.service_address_summary === "No address" ? "Add address first" : undefined}
      >
        {!row.has_valid_coordinates && row.service_address_summary !== "No address" && (
          <div className="mt-2">
            {geoStatus?.status === "success" ? (
              <p className="text-xs" style={{ color: "var(--t-accent)" }}>Geocoded successfully</p>
            ) : (
              <>
                <button onClick={handleRetryGeocode}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium"
                  style={{ borderColor: "var(--t-info)", color: "var(--t-info)" }}>
                  <MapPin className="h-3 w-3" /> Retry Geocoding
                </button>
                {geoStatus?.status === "failed" && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--t-error)" }}>{geoStatus.reason || "Geocoding failed"}</p>
                )}
              </>
            )}
          </div>
        )}
        {row.has_valid_coordinates && (
          <p className="text-xs mt-1" style={{ color: "var(--t-accent)" }}>Valid coordinates on file</p>
        )}
      </CheckItem>

      {/* 2b. Pricing Rule / Dumpster Size */}
      {(row.can_change_subtype || !row.has_pricing_rule) && (
        <CheckItem label="Pricing Rule" done={row.has_pricing_rule} blocked={false}>
          <div className="mt-2">
            <p className="text-[10px] mb-1.5" style={{ color: "var(--t-text-muted)" }}>
              {row.asset_subtype ? `"${row.asset_subtype}" has no active pricing rule.` : "No dumpster size set."}
              {row.supported_subtypes.length > 0 ? " Change to a supported size:" : " No priced sizes available for this tenant."}
            </p>
            {row.supported_subtypes.length > 0 && (
              <div className="flex items-center gap-2">
                <select value={selectedSubtype} onChange={e => setSelectedSubtype(e.target.value)}
                  className="rounded-lg border px-2.5 py-1.5 text-xs outline-none flex-1"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }}>
                  {row.asset_subtype && !row.supported_subtypes.includes(row.asset_subtype) && (
                    <option value={row.asset_subtype} disabled>{row.asset_subtype} (no rule)</option>
                  )}
                  {row.supported_subtypes.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button onClick={handleChangeSubtype}
                  disabled={changingSub || !selectedSubtype || selectedSubtype === row.asset_subtype}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-50 shrink-0"
                  style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                  {changingSub ? "Saving..." : "Change Size"}
                </button>
              </div>
            )}
          </div>
        </CheckItem>
      )}

      {/* 3. Pricing Snapshot */}
      <CheckItem
        label="Pricing Snapshot"
        done={row.has_locked_snapshot}
        blocked={!row.has_valid_coordinates || !row.asset_subtype}
        blockerText={!row.has_valid_coordinates ? "Valid coordinates required" : !row.asset_subtype ? "Asset subtype required" : undefined}
      >
        {row.has_locked_snapshot ? (
          <div className="mt-1 space-y-1 text-xs">
            {row.pricing_locked_at && <p style={{ color: "var(--t-text-muted)" }}>Locked: {new Date(row.pricing_locked_at).toLocaleString()}</p>}
            {row.pricing_snapshot_id && (
              <button onClick={() => onCopyId(row.pricing_snapshot_id!)} className="flex items-center gap-1 font-mono text-[10px]" style={{ color: "var(--t-text-muted)" }}>
                {row.pricing_snapshot_id.slice(0, 16)}... <Copy className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : row.can_generate_snapshot ? (
          <div className="mt-2">
            {snapStatus?.status === "success" ? (
              <p className="text-xs" style={{ color: "var(--t-accent)" }}>Snapshot generated successfully</p>
            ) : (
              <>
                <button onClick={handleGenerateSnapshot}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold"
                  style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                  <Zap className="h-3 w-3" /> Generate Snapshot
                </button>
                {snapStatus?.status === "failed" && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--t-error)" }}>{(snapStatus.reason || "failed").replace(/_/g, " ")}</p>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-[10px] mt-1" style={{ color: "var(--t-text-muted)" }}>
            {row.action_blockers.length > 0 ? `Blocked: ${row.action_blockers.join(", ").replace(/_/g, " ")}` : "Snapshot not applicable"}
          </p>
        )}
      </CheckItem>

      {/* ── Supporting Details ── */}

      {row.is_exchange && (
        <div className="rounded-[12px] border p-3" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: "#a78bfa" }}>Exchange</p>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Pickup</span><span>{row.exchange_pickup_subtype || "—"}</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Dropoff</span><span>{row.exchange_dropoff_subtype || "—"}</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Tonnage</span><span style={{ color: "var(--t-warning)" }}>Pickup container</span></div>
          </div>
        </div>
      )}

      {row.pricing_config_version_id && (
        <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          <span>Config:</span>
          <button onClick={() => onCopyId(row.pricing_config_version_id!)} className="font-mono flex items-center gap-1">
            {row.pricing_config_version_id.slice(0, 16)}... <Copy className="h-3 w-3" />
          </button>
        </div>
      )}

      {(auditHistory.length > 0 || auditLoading) && (
        <div className="rounded-[12px] border p-3" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: "var(--t-text-muted)" }}>Recalculation History</p>
          {auditLoading ? <div className="h-8 skeleton rounded-lg" /> : (
            <div className="space-y-1.5">
              {auditHistory.slice(0, 5).map(a => (
                <div key={a.id} className="flex items-start gap-2 text-[11px]">
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
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        <Link href={`/jobs/${row.job_id}`} className="text-xs font-medium rounded-full border px-3 py-1.5"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>Open Job</Link>
        {row.invoice_id && (
          <Link href={`/invoices/${row.invoice_id}`} className="text-xs font-medium rounded-full border px-3 py-1.5"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>Open Invoice</Link>
        )}
      </div>
    </div>
  );
}
