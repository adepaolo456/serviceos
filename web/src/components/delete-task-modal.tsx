"use client";

import { useState, useEffect } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DeleteTaskModalProps {
  open: boolean;
  onClose: () => void;
  taskId: string | null;
  onDeleted?: () => void;
}

interface CascadePreview {
  task: { id: string; job_number: string; job_type: string; status: string; asset_subtype: string; scheduled_date: string };
  linkedPickup: { id: string; job_number: string; status: string; scheduled_date: string } | null;
  linkedInvoices: { id: string; invoice_number: number; status: string; total: number; amount_paid: number }[];
  assetInfo: { status: string; identifier: string } | null;
  assignedDriver: { first_name: string; last_name: string } | null;
  isInProgress: boolean;
  customerInfo: { first_name: string; last_name: string; account_id: string } | null;
}

/* ------------------------------------------------------------------ */
/*  Toggle                                                             */
/* ------------------------------------------------------------------ */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
      style={{ backgroundColor: checked ? "var(--t-accent)" : "var(--t-border)" }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full transition-transform"
        style={{ backgroundColor: "var(--t-bg-primary)", transform: checked ? "translateX(24px)" : "translateX(4px)" }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DeleteTaskModal({ open, onClose, taskId, onDeleted }: DeleteTaskModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CascadePreview | null>(null);
  const [deletePickup, setDeletePickup] = useState(true);
  const [voidInvoices, setVoidInvoices] = useState<Record<string, boolean>>({});
  const [voidReason, setVoidReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Lock body
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  // Fetch cascade preview
  useEffect(() => {
    if (open && taskId) {
      setLoading(true);
      setPreview(null);
      setDeletePickup(true);
      setVoidInvoices({});
      setVoidReason("");
      setReasonError(false);
      api.get<CascadePreview>(`/jobs/${taskId}/cascade-preview`)
        .then((data) => {
          setPreview(data);
          const invoiceMap: Record<string, boolean> = {};
          (data.linkedInvoices || []).forEach((inv) => { invoiceMap[inv.id] = true; });
          setVoidInvoices(invoiceMap);
        })
        .catch(() => toast("error", "Failed to load task details"))
        .finally(() => setLoading(false));
    }
  }, [open, taskId, toast]);

  const anyVoidToggled = Object.values(voidInvoices).some(Boolean);
  const voidReasonRequired = anyVoidToggled;

  const handleDelete = async () => {
    if (voidReasonRequired && !voidReason.trim()) {
      setReasonError(true);
      return;
    }
    setSubmitting(true);
    try {
      const invoiceIds = Object.entries(voidInvoices)
        .filter(([, v]) => v)
        .map(([id]) => id);
      await api.request(`/jobs/${taskId}`, {
        method: "DELETE",
        body: JSON.stringify({
          deletePickup,
          voidInvoices: invoiceIds,
          voidReason: voidReason.trim() || undefined,
        }),
      });
      toast("success", "Task deleted successfully");
      onDeleted?.();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !taskId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-[20px] shadow-2xl p-6"
        style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 transition-colors"
          style={{ color: "var(--t-text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
        >
          <X className="h-5 w-5" />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--t-text-muted)" }} />
          </div>
        ) : preview ? (
          <div className="space-y-5">
            {/* Header */}
            <div className="text-center">
              <h2 className="text-base font-semibold" style={{ color: "var(--t-text-primary)" }}>
                Delete task
              </h2>
              <p className="text-sm mt-1" style={{ color: "var(--t-text-primary)" }}>
                {preview.task.asset_subtype} {preview.task.job_type} #{preview.task.job_number}
              </p>
              {preview.customerInfo && (
                <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                  {preview.customerInfo.first_name} {preview.customerInfo.last_name}
                </p>
              )}
              {preview.isInProgress && (
                <div className="mt-2 rounded-[20px] px-3 py-2 text-xs font-semibold" style={{ backgroundColor: "var(--t-warning-soft)", color: "var(--t-warning)" }}>
                  This task is currently in progress. Wait until the driver completes or cancels.
                </div>
              )}
            </div>

            {/* Toggle options */}
            {!preview.isInProgress && (
            <div className="space-y-3">
              {preview.linkedPickup && (
                <div className="flex items-center justify-between rounded-[20px] border px-4 py-3" style={{ borderColor: "var(--t-border)", backgroundColor: "var(--t-bg-card)" }}>
                  <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>
                    Also delete the scheduled pickup (#{preview.linkedPickup.job_number})
                  </span>
                  <Toggle checked={deletePickup} onChange={setDeletePickup} />
                </div>
              )}

              {preview.linkedInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-[20px] border px-4 py-3"
                  style={{ borderColor: "var(--t-border)", backgroundColor: "var(--t-bg-card)" }}
                >
                  <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>
                    Void invoice #{inv.invoice_number} ({formatCurrency(Number(inv.total))})
                  </span>
                  <Toggle
                    checked={voidInvoices[inv.id] ?? true}
                    onChange={(v) => setVoidInvoices((prev) => ({ ...prev, [inv.id]: v }))}
                  />
                </div>
              ))}
            </div>
            )}

            {/* Void reason */}
            {voidReasonRequired && (
              <div>
                <label
                  className="block text-[11px] font-semibold uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--t-text-muted)" }}
                >
                  Void Reason
                </label>
                <textarea
                  placeholder="Why is this invoice being voided?"
                  value={voidReason}
                  onChange={(e) => { setVoidReason(e.target.value); setReasonError(false); }}
                  rows={3}
                  className="w-full rounded-[20px] border bg-[var(--t-bg-card)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] resize-none"
                  style={{
                    color: "var(--t-text-primary)",
                    borderColor: reasonError ? "var(--t-error)" : "var(--t-border)",
                  }}
                />
                {reasonError && (
                  <p className="text-xs mt-1" style={{ color: "var(--t-error)" }}>
                    A void reason is required when voiding invoices.
                  </p>
                )}
              </div>
            )}

            {/* Credit warning */}
            {preview.linkedInvoices.some((inv) => voidInvoices[inv.id] && Number(inv.amount_paid) > 0) && (
              <div
                className="flex items-start gap-2 rounded-[20px] px-4 py-3"
                style={{ backgroundColor: "var(--t-warning-soft)", border: "1px solid color-mix(in srgb, var(--t-warning) 30%, transparent)" }}
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--t-warning)" }} />
                <span className="text-sm" style={{ color: "var(--t-warning)" }}>
                  A credit will be applied to the customer&apos;s account for paid amounts on voided invoices.
                </span>
              </div>
            )}

            {/* Footer */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full py-3 text-sm font-semibold border"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || preview.isInProgress || (voidReasonRequired && !voidReason.trim())}
                onClick={handleDelete}
                className="flex-1 rounded-full py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ backgroundColor: "var(--t-error)", color: "var(--t-bg-primary)" }}
              >
                {submitting ? "Deleting..." : "Delete task"}
              </button>
            </div>

            {/* Audit note */}
            <p className="text-center text-[11px]" style={{ color: "var(--t-text-muted)" }}>
              This action is recorded in the audit log and cannot be undone.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
