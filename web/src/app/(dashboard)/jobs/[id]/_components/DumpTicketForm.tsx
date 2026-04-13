"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/**
 * Shape of an existing dump ticket used for edit-mode prefill. Mirrors
 * the subset of `dump_tickets` columns the office form edits. The full
 * row is returned by GET /jobs/:id/dump-slip; only these fields are
 * required for prefill so callers can pass a narrow slice.
 */
export interface DumpTicketFormTicket {
  id: string;
  ticket_number: string;
  waste_type: string;
  weight_tons: number;
  dump_location_id: string;
  ticket_photo?: string;
}

export interface DumpTicketFormProps {
  mode: "create" | "edit";
  open: boolean;
  jobId: string;
  /** Required in edit mode; ignored in create mode. */
  existingTicket?: DumpTicketFormTicket | null;
  /** Dump locations list (parent already lazy-loads and caches these). */
  dumpLocations: Array<{ id: string; name: string }>;
  /** Optional override for the save button label (e.g. "Save & Mark Complete"). */
  saveLabelOverride?: string;
  /** Optional hint rendered above the form body (used by the completion shortcut). */
  hintText?: string;
  onClose: () => void;
  /** Fires after a successful POST/PATCH. Parent should refetch job + tickets. */
  onSaved: () => void;
}

/**
 * Shared office-facing dump ticket form used for three surfaces:
 *   1. Add Dump Slip (create mode)      → POST /jobs/:id/dump-slip
 *   2. Edit Dump Slip (edit mode)       → PATCH /dump-tickets/:ticketId
 *   3. Manual-completion shortcut       → POST /jobs/:id/dump-slip, then
 *                                         parent triggers changeStatus("completed")
 *
 * Canonical mutation paths only — this component NEVER writes directly to
 * `jobs.dump_*`, `job_costs.dump_fee`, `billing_issues`, or `alerts`. Those
 * are all recomputed server-side by DumpLocationsService on POST/PATCH.
 *
 * Audit trail: the backend automatically appends a revision entry to
 * `dump_tickets.revisions` on every PATCH. The optional correction reason
 * below is threaded through to that entry via the `reason` body field.
 *
 * Detector-driven resolution: this component does NOT dismiss or resolve
 * any billing issue or alert. It relies on BillingIssueDetectorService +
 * AlertDetectorService to pick up the recomputed `jobs.dump_weight_tons`
 * on the next pass — preserving the Phase 14 resolution path intact.
 */
export default function DumpTicketForm({
  mode,
  open,
  jobId,
  existingTicket,
  dumpLocations,
  saveLabelOverride,
  hintText,
  onClose,
  onSaved,
}: DumpTicketFormProps) {
  const { toast } = useToast();
  const [locationId, setLocationId] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [weight, setWeight] = useState("");
  const [wasteType, setWasteType] = useState("cnd");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset/prefill whenever the modal opens. Keeping this in an effect
  // (rather than derived state) ensures a clean slate each time the
  // parent toggles `open`, and correctly re-prefills when the parent
  // switches between tickets without closing the modal.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && existingTicket) {
      setLocationId(existingTicket.dump_location_id || "");
      setTicketNumber(existingTicket.ticket_number || "");
      setWeight(
        existingTicket.weight_tons != null
          ? String(existingTicket.weight_tons)
          : "",
      );
      setWasteType(existingTicket.waste_type || "cnd");
    } else {
      setLocationId("");
      setTicketNumber("");
      setWeight("");
      setWasteType("cnd");
    }
    setReason("");
    setError("");
  }, [open, mode, existingTicket]);

  if (!open) return null;

  const save = async () => {
    if (!locationId) {
      setError("Disposal site is required");
      return;
    }
    if (!ticketNumber.trim()) {
      setError("Ticket number is required");
      return;
    }
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w < 0) {
      setError("Weight must be a non-negative number");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (mode === "create") {
        // Canonical create path — POST /jobs/:id/dump-slip.
        // Idempotent on (job_id, ticket_number); auto-syncs job_costs,
        // job denorm fields, and draft invoice server-side.
        await api.post(`/jobs/${jobId}/dump-slip`, {
          dumpLocationId: locationId,
          ticketNumber: ticketNumber.trim(),
          wasteType,
          weightTons: w,
        });
      } else if (existingTicket) {
        // Canonical edit path — PATCH /dump-tickets/:ticketId.
        // Recalculates costs, appends a revisions JSONB entry, syncs
        // job totals and invoice line items — all inside
        // DumpLocationsService.updateDumpTicket().
        await api.patch(`/dump-tickets/${existingTicket.id}`, {
          dumpLocationId: locationId,
          ticketNumber: ticketNumber.trim(),
          wasteType,
          weightTons: w,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
      }
      toast(
        "success",
        FEATURE_REGISTRY.dump_slip_updated?.label ?? "Dump slip updated",
      );
      onSaved();
      onClose();
    } catch (err: unknown) {
      const fallback =
        mode === "edit"
          ? FEATURE_REGISTRY.dump_slip_edit_failed?.label ??
            "Failed to update dump ticket"
          : "Failed to save dump slip";
      const msg = err instanceof Error && err.message ? err.message : fallback;
      setError(msg);
      toast("error", msg);
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === "edit"
      ? FEATURE_REGISTRY.edit_dump_slip_title?.label ?? "Edit Dump Ticket"
      : FEATURE_REGISTRY.add_dump_slip?.label ?? "Add Dump Slip";

  const defaultSaveLabel =
    mode === "edit"
      ? FEATURE_REGISTRY.dump_slip_save_correction?.label ?? "Save Correction"
      : FEATURE_REGISTRY.save_dump_slip?.label ?? "Save Dump Slip";

  const saveLabel = saveLabelOverride ?? defaultSaveLabel;

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
          {title}
        </h3>
        {hintText && (
          <p className="text-xs mb-3" style={{ color: "var(--t-warning)" }}>
            {hintText}
          </p>
        )}
        <p className="text-xs mb-4" style={{ color: "var(--t-text-muted)" }}>
          Records disposal for this job. Cost sync, audit trail, and invoice
          creation run automatically.
        </p>

        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
          Disposal Site
        </label>
        <select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setError("");
          }}
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
        >
          <option value="" disabled>
            Select a disposal site…
          </option>
          {dumpLocations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>

        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
          Ticket Number
        </label>
        <input
          type="text"
          value={ticketNumber}
          onChange={(e) => {
            setTicketNumber(e.target.value);
            setError("");
          }}
          placeholder="e.g. T-12345"
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
        />

        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
          Weight (tons)
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={weight}
          onChange={(e) => {
            setWeight(e.target.value);
            setError("");
          }}
          placeholder="0.00"
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
        />

        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
          Waste Type
        </label>
        <select
          value={wasteType}
          onChange={(e) => setWasteType(e.target.value)}
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
        >
          <option value="cnd">Construction & Demolition</option>
          <option value="msw">Municipal Solid Waste</option>
          <option value="clean_fill">Clean Fill</option>
          <option value="concrete">Concrete</option>
          <option value="asphalt">Asphalt</option>
          <option value="roofing">Roofing</option>
          <option value="yard_waste">Yard Waste</option>
        </select>

        {mode === "edit" && (
          <>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
              {FEATURE_REGISTRY.dump_slip_correction_reason?.label ??
                "Correction reason (optional)"}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Driver entered wrong weight"
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
            />
          </>
        )}

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
            onClick={save}
            disabled={saving || !locationId || !ticketNumber.trim() || !weight}
            className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
