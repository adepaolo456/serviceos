"use client";

/**
 * Phase 16 — Edit Pickup Date modal
 *
 * Opens from the Connected Job Lifecycle panel on the active
 * (non-cancelled) pickup node. Click-anywhere date picker
 * (Phase 10B convention: inline `onClick={e => e.target.
 * showPicker?.()}`), live preview of old/new dates + rental
 * duration, and a server call to
 *   PUT /jobs/:id/pickup-date
 *
 * ALL user-facing strings come from the feature registry via
 * getFeatureLabel — spec rule "NO HARDCODED LABELS".
 *
 * Validation mirrors the backend:
 *   - new >= today
 *   - new >  chain.drop_off_date (strictly greater — no
 *     zero-day rentals)
 * The Save button stays disabled until both checks pass, so
 * the server-side 400 should be unreachable via normal UI use.
 * The modal still surfaces the server error codes if they do
 * fire (e.g. if the clock drifts).
 */

import { useRef, useState, useMemo } from "react";
import { X, CalendarClock, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { getFeatureLabel, getFeature } from "@/lib/feature-registry";
import HelpTooltip from "@/components/ui/HelpTooltip";

// Shared formatter — keeps the modal rendering consistent with
// the rest of the lifecycle panel without cross-importing.
function fmtDate(d: string | null): string {
  if (!d) return "";
  try {
    const date = new Date(d.length === 10 ? `${d}T00:00:00` : d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

/**
 * Canonical duration math — matches the backend's exported
 * `daysBetween` from rental-chains.service.ts byte for byte
 * (except for the trailing `T00:00:00Z` anchor, which we use
 * here too so the preview agrees with the server result).
 */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function EditPickupDateModal({
  jobId,
  currentPickupDate,
  dropOffDate,
  onClose,
  onSaved,
}: {
  jobId: string;
  currentPickupDate: string;
  dropOffDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [newDate, setNewDate] = useState<string>(currentPickupDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const minDate = useMemo(() => {
    // The <input min=""> attribute enforces the stricter of
    // today and (drop_off_date + 1 day). Server-side rules are
    // "new >= today" and "new > drop_off_date", so we want the
    // min picker value to be the later of (today) and (drop_off
    // + 1 day).
    const dayAfterDropOff = (() => {
      try {
        const d = new Date(`${dropOffDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().split("T")[0];
      } catch {
        return dropOffDate;
      }
    })();
    return today > dayAfterDropOff ? today : dayAfterDropOff;
  }, [today, dropOffDate]);

  // Live-computed validation + preview.
  const validation = useMemo(() => {
    if (!newDate) {
      return { valid: false, errorKey: "edit_pickup_date_error_invalid" };
    }
    if (newDate < today) {
      return { valid: false, errorKey: "edit_pickup_date_error_past_date" };
    }
    if (newDate <= dropOffDate) {
      return {
        valid: false,
        errorKey: "edit_pickup_date_error_before_drop_off",
      };
    }
    return { valid: true, errorKey: null as string | null };
  }, [newDate, today, dropOffDate]);

  const oldDuration = daysBetween(dropOffDate, currentPickupDate);
  const newDuration = daysBetween(dropOffDate, newDate);
  const durationChanged = newDate !== currentPickupDate && validation.valid;
  const dirty = newDate !== currentPickupDate;

  async function handleSave() {
    if (!validation.valid) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/jobs/${jobId}/pickup-date`, { pickup_date: newDate });
      toast.toast("success", getFeatureLabel("edit_pickup_date_toast_saved"));
      onSaved();
      onClose();
    } catch (err) {
      // Backend errors come back as registry-key strings (e.g.
      // "edit_pickup_date_error_past_date"). Resolve via the
      // registry if we recognize the code, otherwise show the
      // raw message.
      const msg = err instanceof Error ? err.message : "Save failed";
      const registered = getFeature(msg);
      setError(registered ? getFeatureLabel(msg) : msg);
      toast.toast("error", registered ? getFeatureLabel(msg) : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[18px] p-6"
        style={{
          background: "var(--t-bg-card)",
          border: "1px solid var(--t-border)",
          boxShadow: "0 20px 60px var(--t-shadow-lg)",
        }}
      >
        {/* ── Header ────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarClock
              className="h-5 w-5"
              style={{ color: "var(--t-accent)" }}
            />
            <h2
              className="text-[17px] font-bold tracking-[-0.3px]"
              style={{ color: "var(--t-text-primary)" }}
            >
              {getFeatureLabel("edit_pickup_date_modal")}
            </h2>
            <HelpTooltip featureId="edit_pickup_date" placement="right" />
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1"
            style={{ color: "var(--t-text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Current date readout ─────────────────────── */}
        <div className="mb-4">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: "var(--t-text-muted)" }}
          >
            {getFeatureLabel("edit_pickup_date_current_label")}
          </p>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--t-text-primary)" }}
          >
            {fmtDate(currentPickupDate)}
          </p>
        </div>

        {/* ── New date input ───────────────────────────── */}
        <div className="mb-4">
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: "var(--t-text-muted)" }}
          >
            {getFeatureLabel("edit_pickup_date_new_label")}
            <HelpTooltip featureId="edit_pickup_date_modal" placement="right" />
          </label>
          <input
            ref={dateInputRef}
            type="date"
            value={newDate}
            min={minDate}
            onChange={(e) => setNewDate(e.target.value)}
            onClick={(e) => {
              // Phase 10B click-anywhere pattern — inline, same
              // convention as new-customer-form.tsx. Silent fallback
              // on browsers without showPicker (pre-Safari 16.4).
              try {
                (e.target as HTMLInputElement).showPicker?.();
              } catch {
                /* ignore */
              }
            }}
            className="w-full rounded-[12px] border px-3 py-2.5 text-sm outline-none"
            style={{
              background: "var(--t-bg-elevated)",
              borderColor: validation.valid
                ? "var(--t-border)"
                : "var(--t-error)",
              color: "var(--t-text-primary)",
            }}
          />
        </div>

        {/* ── Validation error ─────────────────────────── */}
        {!validation.valid && validation.errorKey && dirty && (
          <div
            className="mb-4 flex items-start gap-2 rounded-[10px] border p-2.5"
            style={{
              background: "var(--t-bg-elevated)",
              borderColor: "var(--t-error)",
              color: "var(--t-error)",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p className="text-xs">{getFeatureLabel(validation.errorKey)}</p>
          </div>
        )}

        {/* ── Preview section (live) ───────────────────── */}
        {dirty && validation.valid && (
          <div
            className="mb-4 rounded-[12px] border p-3"
            style={{
              background: "var(--t-bg-elevated)",
              borderColor: "var(--t-border)",
            }}
          >
            <p
              className="text-[11px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--t-text-muted)" }}
            >
              {getFeatureLabel("edit_pickup_date_preview")}
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span style={{ color: "var(--t-text-muted)" }}>
                  {getFeatureLabel("edit_pickup_date_current_label")}
                </span>
                <span style={{ color: "var(--t-text-primary)" }}>
                  {fmtDate(currentPickupDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--t-text-muted)" }}>
                  {getFeatureLabel("edit_pickup_date_new_label")}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--t-accent)" }}
                >
                  {fmtDate(newDate)}
                </span>
              </div>
              {durationChanged && (
                <div
                  className="flex justify-between pt-1.5 border-t"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  <span style={{ color: "var(--t-text-muted)" }}>
                    {getFeatureLabel("edit_pickup_date_duration_label")}
                  </span>
                  <span style={{ color: "var(--t-text-primary)" }}>
                    {oldDuration} → <strong>{newDuration}</strong>{" "}
                    {getFeatureLabel("edit_pickup_date_days_suffix")}
                  </span>
                </div>
              )}
              <div
                className="flex items-center gap-1.5 pt-1.5 mt-1 border-t"
                style={{ borderColor: "var(--t-border)" }}
              >
                <span
                  className="inline-block text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5"
                  style={{
                    background: "var(--t-warning)",
                    color: "#fff",
                  }}
                >
                  {getFeatureLabel("edit_pickup_date_manual_override_badge")}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Server error (from failed save) ──────────── */}
        {error && (
          <div
            className="mb-4 flex items-start gap-2 rounded-[10px] border p-2.5"
            style={{
              background: "var(--t-bg-elevated)",
              borderColor: "var(--t-error)",
              color: "var(--t-error)",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p className="text-xs">{error}</p>
          </div>
        )}

        {/* ── Actions ──────────────────────────────────── */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-full border px-4 py-2 text-xs font-medium"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            {getFeatureLabel("edit_pickup_date_cancel_label")}
          </button>
          <button
            onClick={handleSave}
            disabled={!validation.valid || !dirty || saving}
            className="rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-50"
            style={{
              background: "var(--t-accent)",
              color: "#fff",
            }}
          >
            {saving
              ? getFeatureLabel("edit_pickup_date_saving_label")
              : getFeatureLabel("edit_pickup_date_save_label")}
          </button>
        </div>
      </div>
    </div>
  );
}
