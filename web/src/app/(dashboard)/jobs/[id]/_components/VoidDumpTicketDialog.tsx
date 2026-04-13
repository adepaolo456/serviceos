"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

export interface VoidDumpTicketDialogProps {
  ticket: { id: string; ticket_number: string | null } | null;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful POST /dump-tickets/:id/void. */
  onVoided: () => void;
}

/**
 * Confirmation dialog for voiding a dump ticket. Calls the canonical
 * POST /dump-tickets/:ticketId/void endpoint, which:
 *   - appends a revisions JSONB entry with the supplied reason
 *   - marks the ticket voided + records voided_at/voided_by/void_reason
 *   - deletes the linked job_costs dump_fee row
 *   - recalculates jobs.dump_total_cost and customer_additional_charges
 *   - recalculates linked invoice line items and balance
 *
 * Role enforcement: the backend restricts voids to admin/dispatcher/owner
 * and returns a 400 otherwise. The UI surfaces that error via toast —
 * there is no client-side role gate so this component stays naive and
 * relies on the server as the single source of truth.
 *
 * Detector-driven resolution preserved: this component does NOT touch
 * `billing_issues` or `alerts`. BillingIssueDetectorService picks up
 * the recomputed jobs.dump_weight_tons on its next pass.
 */
export default function VoidDumpTicketDialog({
  ticket,
  open,
  onClose,
  onVoided,
}: VoidDumpTicketDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open, ticket?.id]);

  if (!open || !ticket) return null;

  const confirm = async () => {
    if (!reason.trim()) {
      setError("A reason is required to void a dump ticket.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/dump-tickets/${ticket.id}/void`, {
        reason: reason.trim(),
      });
      toast(
        "success",
        FEATURE_REGISTRY.dump_slip_voided?.label ?? "Dump ticket voided",
      );
      onVoided();
      onClose();
    } catch (err: unknown) {
      const fallback =
        FEATURE_REGISTRY.dump_slip_void_failed?.label ??
        "Failed to void dump ticket";
      const msg = err instanceof Error && err.message ? err.message : fallback;
      setError(msg);
      toast("error", fallback);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={saving ? undefined : onClose}
      />
      <div
        className="relative rounded-[20px] p-6 w-full max-w-md shadow-2xl"
        style={{
          backgroundColor: "var(--t-bg-secondary)",
          border: "1px solid var(--t-border)",
        }}
      >
        <h3
          className="text-base font-semibold mb-1"
          style={{ color: "var(--t-text-primary)" }}
        >
          {FEATURE_REGISTRY.void_dump_slip_title?.label ?? "Void Dump Ticket"}
        </h3>
        <p className="text-xs mb-1" style={{ color: "var(--t-text-muted)" }}>
          Ticket #{ticket.ticket_number || ticket.id}
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--t-error)" }}>
          {FEATURE_REGISTRY.void_dump_slip_description?.label ??
            "Voiding removes this ticket's financial impact. This cannot be undone."}
        </p>

        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
          {FEATURE_REGISTRY.void_dump_slip_reason_label?.label ??
            "Void reason (required)"}
        </label>
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError("");
          }}
          rows={3}
          placeholder="e.g. Wrong ticket attached to this job"
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3 resize-none"
        />

        {error && <p className="text-xs text-[var(--t-error)] mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={saving || !reason.trim()}
            className="rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: "var(--t-error)",
              color: "var(--t-error-on-error, white)",
            }}
          >
            {saving
              ? "Voiding…"
              : FEATURE_REGISTRY.void_dump_slip_confirm?.label ?? "Void Ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
