"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PhoneOff,
  AlertTriangle,
  X,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";

const ADMIN_SMS_LABELS = {
  pageTitle: "SMS Number Release Requests",
  pageSubtitle:
    "Tenant-submitted requests to release dedicated SMS numbers from Twilio.",
  empty: "No release requests yet.",
  filterAll: "All",
  filterPending: "Pending",
  filterReleased: "Released",
  filterRejected: "Rejected",
  filterFailed: "Failed",
  colTenant: "Tenant",
  colNumber: "Number",
  colStatus: "Status",
  colRequested: "Requested",
  colRequester: "Requested by",
  colActivity: "Last 7d / Last outbound",
  reviewModalTitle: "Review release request",
  releaseNumber: "Release Number",
  rejectRequest: "Reject Request",
  reconcileRequest: "Reconcile DB",
  smsReleaseStopsBilling:
    "Releasing this number will stop Twilio billing for it immediately.",
  smsReleaseIrreversibleWarning:
    "This action is irreversible. Customers will no longer be able to text this number, and the number may not be recoverable.",
  numberMismatchWarning:
    "WARNING: The tenant's currently assigned number no longer matches the number on this request. Releasing now is unsafe — reject and ask the tenant to submit a new request.",
  reconcileWarning:
    "Twilio release already succeeded but tenant settings cleanup failed. Reconcile will only clear the orphaned tenant_settings reference.",
  notesPlaceholder: "Optional review notes",
  releasing: "Releasing…",
  rejecting: "Rejecting…",
  reconciling: "Reconciling…",
};

interface ReleaseRequest {
  id: string;
  tenant_id: string;
  sms_phone_number: string;
  status: "pending" | "rejected" | "released" | "failed";
  requested_by_user_id: string;
  requested_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  released_at: string | null;
  provider_phone_sid: string | null;
  failure_reason: string | null;
  created_at: string;
}

interface ListRow {
  request: ReleaseRequest;
  tenant_name: string;
  requested_by_email: string | null;
  activity_summary: { last_outbound_at: string | null; messages_last_7d: number };
}

interface DetailResponse {
  request: ReleaseRequest;
  tenant: { id: string; name: string; slug: string } | null;
  requested_by: { id: string; email: string } | null;
  reviewed_by: { id: string; email: string } | null;
  activity: {
    sms_enabled: boolean;
    current_assigned_number: string | null;
    number_matches_request: boolean;
    inbound_count_total: number;
    outbound_count_total: number;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
    messages_last_7d: number;
  };
}

const STATUS_FILTERS: Array<{
  key: string;
  label: string;
  apiValue?: string;
}> = [
  { key: "pending", label: ADMIN_SMS_LABELS.filterPending, apiValue: "pending" },
  { key: "released", label: ADMIN_SMS_LABELS.filterReleased, apiValue: "released" },
  { key: "rejected", label: ADMIN_SMS_LABELS.filterRejected, apiValue: "rejected" },
  { key: "failed", label: ADMIN_SMS_LABELS.filterFailed, apiValue: "failed" },
  { key: "all", label: ADMIN_SMS_LABELS.filterAll },
];

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  pending: { color: "var(--t-warning)", bg: "var(--t-warning-soft, rgba(234,179,8,0.1))", label: "Pending" },
  released: { color: "var(--t-success, #22c55e)", bg: "var(--t-success-soft, rgba(34,197,94,0.1))", label: "Released" },
  rejected: { color: "var(--t-text-muted)", bg: "var(--t-bg-elevated, #e5e7eb)", label: "Rejected" },
  failed: { color: "var(--t-error)", bg: "color-mix(in srgb, var(--t-error) 12%, transparent)", label: "Failed" },
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString();
}

function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164;
}

export default function AdminSmsRequestsPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("pending");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const apiVal = STATUS_FILTERS.find((f) => f.key === filter)?.apiValue;
      const qs = apiVal ? `?status=${apiVal}` : "";
      const data = await api.get<ListRow[]>(`/admin/sms-release-requests${qs}`);
      setRows(data || []);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
          {ADMIN_SMS_LABELS.pageTitle}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
          {ADMIN_SMS_LABELS.pageSubtitle}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: isActive ? "var(--t-accent)" : "var(--t-bg-card)",
                color: isActive ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
                border: "1px solid var(--t-border)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--t-border)]">
                {[
                  ADMIN_SMS_LABELS.colTenant,
                  ADMIN_SMS_LABELS.colNumber,
                  ADMIN_SMS_LABELS.colStatus,
                  ADMIN_SMS_LABELS.colRequested,
                  ADMIN_SMS_LABELS.colRequester,
                  ADMIN_SMS_LABELS.colActivity,
                ].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-[var(--t-text-muted)]">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <PhoneOff className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
                    <p className="text-sm text-[var(--t-text-muted)]">{ADMIN_SMS_LABELS.empty}</p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const s = STATUS_STYLES[row.request.status] || STATUS_STYLES.pending;
                  return (
                    <tr
                      key={row.request.id}
                      onClick={() => setSelectedId(row.request.id)}
                      className="border-b border-[var(--t-border)] last:border-0 hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3.5 font-medium text-[var(--t-text-primary)]">{row.tenant_name}</td>
                      <td className="px-5 py-3.5 font-mono text-[var(--t-text-primary)]">{formatPhone(row.request.sms_phone_number)}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className="inline-flex items-center text-[11px] font-semibold rounded-full px-2.5 py-0.5"
                          style={{ backgroundColor: s.bg, color: s.color }}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[var(--t-text-muted)]">
                        {formatDateTime(row.request.requested_at)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[var(--t-text-muted)]">
                        {row.requested_by_email || "—"}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[var(--t-text-muted)] tabular-nums">
                        {row.activity_summary.messages_last_7d} · {row.activity_summary.last_outbound_at ? new Date(row.activity_summary.last_outbound_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedId && (
        <ReviewModal
          requestId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            setSelectedId(null);
            load();
          }}
          labels={ADMIN_SMS_LABELS}
        />
      )}
    </div>
  );
}

function ReviewModal({
  requestId,
  onClose,
  onChanged,
  labels,
}: {
  requestId: string;
  onClose: () => void;
  onChanged: () => void;
  labels: typeof ADMIN_SMS_LABELS;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"release" | "reject" | "reconcile" | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .get<DetailResponse>(`/admin/sms-release-requests/${requestId}`)
      .then((d) => setDetail(d))
      .catch((err) => toast("error", err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [requestId, toast]);

  const callAction = async (action: "release" | "reject" | "reconcile") => {
    setBusy(action);
    try {
      await api.post(`/admin/sms-release-requests/${requestId}/${action}`, { notes: notes || undefined });
      toast(
        "success",
        action === "release" ? "Number released" : action === "reject" ? "Request rejected" : "Reconciled",
      );
      onChanged();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  };

  const isPending = detail?.request.status === "pending";
  const isFailed = detail?.request.status === "failed";
  const reconcileEligible = isFailed && !!detail?.request.released_at;
  const numberMismatch = !!detail && detail.activity.current_assigned_number !== detail.request.sms_phone_number;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div
        className="relative w-full max-w-lg rounded-[20px] shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}
      >
        <button
          onClick={() => !busy && onClose()}
          className="absolute top-4 right-4 rounded-lg p-1.5"
          style={{ color: "var(--t-text-muted)" }}
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-semibold mb-4 pr-8" style={{ color: "var(--t-text-primary)" }}>
          {labels.reviewModalTitle}
        </h2>

        {loading || !detail ? (
          <div className="py-12 text-center text-sm text-[var(--t-text-muted)]">Loading…</div>
        ) : (
          <div className="space-y-4">
            {/* Tenant + number */}
            <div className="rounded-[14px] border p-4 space-y-2" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
              <Row label="Tenant" value={detail.tenant?.name || "—"} />
              <Row label="Number on request" value={formatPhone(detail.request.sms_phone_number)} mono />
              <Row
                label="Currently assigned"
                value={detail.activity.current_assigned_number ? formatPhone(detail.activity.current_assigned_number) : "—"}
                mono
                warn={numberMismatch}
              />
              <Row label="SMS enabled" value={detail.activity.sms_enabled ? "Yes" : "No"} />
              <Row label="Requested by" value={detail.requested_by?.email || "—"} />
              <Row label="Requested at" value={formatDateTime(detail.request.requested_at)} />
              {detail.reviewed_by && (
                <Row label="Reviewed by" value={detail.reviewed_by.email} />
              )}
              {detail.request.released_at && (
                <Row label="Released at" value={formatDateTime(detail.request.released_at)} />
              )}
            </div>

            {/* Activity context */}
            <div className="rounded-[14px] border p-4 space-y-2" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>
                Recent SMS activity
              </p>
              <Row label="Inbound (all-time)" value={String(detail.activity.inbound_count_total)} />
              <Row label="Outbound (all-time)" value={String(detail.activity.outbound_count_total)} />
              <Row label="Last 7 days" value={String(detail.activity.messages_last_7d)} />
              <Row label="Last inbound" value={formatDateTime(detail.activity.last_inbound_at)} />
              <Row label="Last outbound" value={formatDateTime(detail.activity.last_outbound_at)} />
            </div>

            {detail.request.failure_reason && (
              <div
                className="rounded-[14px] border px-4 py-3 text-xs"
                style={{
                  borderColor: "color-mix(in srgb, var(--t-error) 30%, transparent)",
                  background: "color-mix(in srgb, var(--t-error) 8%, transparent)",
                  color: "var(--t-error)",
                }}
              >
                <strong>Failure reason:</strong> {detail.request.failure_reason}
              </div>
            )}

            {/* Warnings */}
            {isPending && numberMismatch && (
              <Warn>{labels.numberMismatchWarning}</Warn>
            )}
            {isPending && !numberMismatch && (
              <>
                <Warn>{labels.smsReleaseStopsBilling}</Warn>
                <Warn>{labels.smsReleaseIrreversibleWarning}</Warn>
              </>
            )}
            {reconcileEligible && <Warn>{labels.reconcileWarning}</Warn>}

            {/* Notes */}
            {(isPending || reconcileEligible) && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={labels.notesPlaceholder}
                rows={2}
                className="w-full rounded-[14px] border bg-[var(--t-bg-card)] px-4 py-2.5 text-sm outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] resize-none"
                style={{ color: "var(--t-text-primary)", borderColor: "var(--t-border)" }}
              />
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {isPending && (
                <>
                  <button
                    type="button"
                    disabled={!!busy || numberMismatch}
                    onClick={() => callAction("release")}
                    className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                    style={{ backgroundColor: "var(--t-error)", color: "var(--t-bg-primary)" }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {busy === "release" ? labels.releasing : labels.releaseNumber}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => callAction("reject")}
                    className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold border disabled:opacity-40"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                  >
                    <XCircle className="h-4 w-4" />
                    {busy === "reject" ? labels.rejecting : labels.rejectRequest}
                  </button>
                </>
              )}
              {reconcileEligible && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => callAction("reconcile")}
                  className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: "var(--t-warning)", color: "var(--t-bg-primary)" }}
                >
                  <RefreshCw className="h-4 w-4" />
                  {busy === "reconcile" ? labels.reconciling : labels.reconcileRequest}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  warn = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--t-text-muted)]">{label}</span>
      <span
        className={mono ? "font-mono" : ""}
        style={{ color: warn ? "var(--t-error)" : "var(--t-text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[14px] px-4 py-3 text-xs"
      style={{
        backgroundColor: "var(--t-warning-soft, rgba(234,179,8,0.08))",
        border: "1px solid color-mix(in srgb, var(--t-warning) 30%, transparent)",
        color: "var(--t-warning)",
      }}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
