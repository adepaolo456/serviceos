"use client";

/**
 * Phase 16.1 — Edit Job Date modal (shared for delivery,
 * pickup, and exchange).
 *
 * Replaces the Phase 16 EditPickupDateModal. The modal adapts
 * its labels, validation rules, and preview behavior based on
 * the `jobType` prop (which comes from task_chain_links.task_type):
 *
 *   drop_off  → delivery
 *     · New date must be >= today AND < chain.expected_pickup_date
 *     · Server also blocks saves where an existing exchange sits
 *       on/before the new delivery date
 *     · Preview shows duration change (shrinks/extends the rental)
 *
 *   pick_up   → pickup
 *     · New date must be >= today AND > chain.drop_off_date
 *     · Preview shows duration change
 *
 *   exchange  → exchange
 *     · New date must be >= today AND in the open interval
 *       (chain.drop_off_date, chain.expected_pickup_date)
 *     · No duration change — the rental window stays fixed
 *     · Preview shows a "No rental duration change" line
 *
 * All three talk to a single endpoint:
 *   PUT /jobs/:id/scheduled-date { scheduled_date }
 *
 * Validation mirrors the backend byte for byte so the Save
 * button disables before a bad request can fire. Server error
 * codes come back as registry keys (e.g. `edit_job_date_error_
 * after_pickup`) and resolve via getFeatureLabel so both sides
 * share one translation table.
 *
 * ALL user-facing strings come from the feature registry —
 * spec rule "NO HARDCODED LABELS".
 */

import { useRef, useState, useMemo } from "react";
import { X, CalendarClock, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { getFeatureLabel, getFeature } from "@/lib/feature-registry";
import HelpTooltip from "@/components/ui/HelpTooltip";
import { broadcastLifecycleChange } from "@/lib/lifecycle-sync";

// ─────────────────────────────────────────────────────────────
// Local helpers (duplicated from LifecycleContextPanel to keep
// this modal self-contained — matches the Phase 16 convention).
// ─────────────────────────────────────────────────────────────

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
 * Mirrors the backend's exported `daysBetween` in
 * rental-chains.service.ts byte for byte so the live preview
 * always agrees with what the server will actually persist.
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

function dayAfter(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  } catch {
    return iso;
  }
}

function dayBefore(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  } catch {
    return iso;
  }
}

/**
 * Shift a YYYY-MM-DD date by N days (UTC-safe). Used by the
 * pickup-date auto-vs-override preview (Phase 2b G1).
 */
function shiftDays(iso: string, days: number): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0];
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────
// Type slug — maps task_type values (drop_off/pick_up/exchange)
// to registry-key slugs (delivery/pickup/exchange). Keeps the
// existing Phase 16 `edit_pickup_date_*` family serving the
// pickup case unchanged while the new `edit_delivery_date_*`
// and `edit_exchange_date_*` families handle the other two.
// ─────────────────────────────────────────────────────────────

export type EditableJobType = "drop_off" | "pick_up" | "exchange";

const TYPE_SLUG: Record<EditableJobType, "delivery" | "pickup" | "exchange"> = {
  drop_off: "delivery",
  pick_up: "pickup",
  exchange: "exchange",
};

function labelKey(jobType: EditableJobType, suffix: string): string {
  return `edit_${TYPE_SLUG[jobType]}_date_${suffix}`;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function EditJobDateModal({
  jobId,
  jobType,
  currentDate,
  dropOffDate,
  expectedPickupDate,
  onClose,
  onSaved,
  chainId,
  latestExchangeDate,
  tenantRentalDays,
}: {
  jobId: string;
  jobType: EditableJobType;
  currentDate: string;
  dropOffDate: string;
  expectedPickupDate: string;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Phase 2b G3 — rental chain id of the hosting lifecycle panel.
   * When present, a successful save fires
   * `broadcastLifecycleChange(chainId)` so dispatch, jobs list,
   * and other useLifecycleSync subscribers refresh cross-tab —
   * mirrors the rentals-page Change Pickup flow.
   */
  chainId?: string | null;
  /**
   * Phase 2b G2 — latest scheduled non-cancelled exchange date in
   * this chain, if any. Used for the pickup-branch pre-submit
   * guard: pickup must not land on or before the most recent
   * exchange. Matches the rentals-page client-side rule at
   * rentals/[id]/page.tsx:301-305.
   */
  latestExchangeDate?: string | null;
  /**
   * Phase 2b G1 — tenant-configured rental duration from the
   * chain row. Drives the auto-vs-override preview line for the
   * pickup branch. Null/absent hides the preview row.
   */
  tenantRentalDays?: number | null;
}) {
  const toast = useToast();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [newDate, setNewDate] = useState<string>(currentDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const slug = TYPE_SLUG[jobType];
  const durationAffecting = slug === "delivery" || slug === "pickup";

  // Min/max bounds on the <input type="date"> element are the
  // first line of defense. The effective rules per type:
  //   drop_off (delivery): today <= new < expected_pickup_date
  //   pick_up  (pickup)  : max(today, drop_off + 1 day) <= new
  //   exchange           : max(today, drop_off + 1 day) <= new < expected_pickup_date
  const { minDate, maxDate } = useMemo(() => {
    if (slug === "delivery") {
      const minD = today;
      const maxD = expectedPickupDate ? dayBefore(expectedPickupDate) : undefined;
      return { minDate: minD, maxDate: maxD };
    }
    if (slug === "pickup") {
      const floor = dropOffDate ? dayAfter(dropOffDate) : today;
      const minD = today > floor ? today : floor;
      return { minDate: minD, maxDate: undefined };
    }
    // exchange
    const floor = dropOffDate ? dayAfter(dropOffDate) : today;
    const minD = today > floor ? today : floor;
    const maxD = expectedPickupDate ? dayBefore(expectedPickupDate) : undefined;
    return { minDate: minD, maxDate: maxD };
  }, [slug, today, dropOffDate, expectedPickupDate]);

  // Live validation — mirrors the backend rules exactly so the
  // Save button disables BEFORE a bad request can fire.
  const validation = useMemo(() => {
    if (!newDate) {
      return { valid: false, errorKey: "edit_job_date_error_invalid" as const };
    }
    if (newDate < today) {
      return {
        valid: false,
        errorKey: "edit_job_date_error_past_date" as const,
      };
    }
    if (slug === "delivery") {
      if (!expectedPickupDate || newDate >= expectedPickupDate) {
        return {
          valid: false,
          errorKey: "edit_job_date_error_after_pickup" as const,
        };
      }
    } else if (slug === "pickup") {
      if (!dropOffDate || newDate <= dropOffDate) {
        return {
          valid: false,
          errorKey: "edit_job_date_error_before_drop_off" as const,
        };
      }
      // Phase 2b G2 — exchange-aware guard. A chain with a
      // scheduled (non-cancelled) exchange must not accept a
      // pickup date on or before that exchange. Neither backend
      // endpoint enforces this today; the rentals-page modal was
      // the only surface with this pre-submit check. Reuses the
      // existing `validation_pickup_before_exchange` registry key.
      if (latestExchangeDate && newDate <= latestExchangeDate) {
        return {
          valid: false,
          errorKey: "validation_pickup_before_exchange" as const,
        };
      }
    } else {
      // exchange — must fall strictly inside the chain window
      if (!dropOffDate || newDate <= dropOffDate) {
        return {
          valid: false,
          errorKey: "edit_job_date_error_before_drop_off" as const,
        };
      }
      if (!expectedPickupDate || newDate >= expectedPickupDate) {
        return {
          valid: false,
          errorKey: "edit_job_date_error_after_pickup" as const,
        };
      }
    }
    return { valid: true, errorKey: null };
  }, [newDate, today, slug, dropOffDate, expectedPickupDate]);

  // Duration preview — only meaningful for delivery + pickup.
  // For delivery, substitute the new delivery date as the chain
  // drop_off; for pickup, substitute the new pickup as the
  // chain expected_pickup. Exchange is duration-neutral.
  const oldDuration = useMemo(() => {
    if (!dropOffDate || !expectedPickupDate) return 0;
    return daysBetween(dropOffDate, expectedPickupDate);
  }, [dropOffDate, expectedPickupDate]);
  const newDuration = useMemo(() => {
    if (!durationAffecting) return oldDuration;
    if (slug === "delivery") return daysBetween(newDate, expectedPickupDate);
    if (slug === "pickup") return daysBetween(dropOffDate, newDate);
    return oldDuration;
  }, [
    durationAffecting,
    slug,
    newDate,
    dropOffDate,
    expectedPickupDate,
    oldDuration,
  ]);

  // Phase 2b G1 — pickup auto-vs-override preview inputs.
  // Matches the rentals-page rule exactly: base date is the latest
  // non-cancelled exchange if one exists, otherwise the chain's
  // drop_off_date. Auto pickup = base + tenant rental days.
  const pickupAutoInfo = useMemo(() => {
    if (slug !== "pickup") return null;
    if (tenantRentalDays == null || tenantRentalDays <= 0) return null;
    const baseDate = latestExchangeDate || dropOffDate;
    if (!baseDate) return null;
    const autoDate = shiftDays(baseDate, tenantRentalDays);
    return { autoDate, rentalDays: tenantRentalDays };
  }, [slug, tenantRentalDays, latestExchangeDate, dropOffDate]);

  const dirty = newDate !== currentDate;
  const durationChanged =
    durationAffecting && dirty && validation.valid && newDuration !== oldDuration;

  async function handleSave() {
    if (!validation.valid) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/jobs/${jobId}/scheduled-date`, {
        scheduled_date: newDate,
      });
      toast.toast("success", getFeatureLabel(labelKey(jobType, "toast_saved")));
      // Phase 2b G3 — cross-tab + cross-surface refresh invariant.
      // Mirrors the rentals-page Change Pickup handler's post-save
      // broadcast (rentals/[id]/page.tsx:316) so dispatch, jobs
      // list, and any other useLifecycleSync subscriber refreshes
      // immediately. Only fires when the hosting panel supplied a
      // chainId (i.e. this job is actually part of a chain) and
      // only after a successful backend write.
      if (chainId) {
        broadcastLifecycleChange(chainId);
      }
      onSaved();
      onClose();
    } catch (err) {
      // Backend errors come back as registry-key strings. Try
      // to resolve; fall back to the raw message if unrecognized.
      const msg = err instanceof Error ? err.message : "Save failed";
      const registered = getFeature(msg);
      const resolved = registered ? getFeatureLabel(msg) : msg;
      setError(resolved);
      toast.toast("error", resolved);
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
              {getFeatureLabel(labelKey(jobType, "modal"))}
            </h2>
            <HelpTooltip featureId="edit_job_date" placement="right" />
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
            {getFeatureLabel(labelKey(jobType, "current_label"))}
          </p>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--t-text-primary)" }}
          >
            {fmtDate(currentDate)}
          </p>
        </div>

        {/* ── New date input ───────────────────────────── */}
        <div className="mb-4">
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: "var(--t-text-muted)" }}
          >
            {getFeatureLabel(labelKey(jobType, "new_label"))}
            <HelpTooltip
              featureId={labelKey(jobType, "modal")}
              placement="right"
            />
          </label>
          <input
            ref={dateInputRef}
            type="date"
            value={newDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => setNewDate(e.target.value)}
            onClick={(e) => {
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

        {/* ── Inline validation error ──────────────────── */}
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
              {getFeatureLabel("edit_job_date_preview")}
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span style={{ color: "var(--t-text-muted)" }}>
                  {getFeatureLabel(labelKey(jobType, "current_label"))}
                </span>
                <span style={{ color: "var(--t-text-primary)" }}>
                  {fmtDate(currentDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--t-text-muted)" }}>
                  {getFeatureLabel(labelKey(jobType, "new_label"))}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--t-accent)" }}
                >
                  {fmtDate(newDate)}
                </span>
              </div>

              {/* Duration row — only shown for delivery + pickup */}
              {durationAffecting && durationChanged && (
                <div
                  className="flex justify-between pt-1.5 border-t"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  <span style={{ color: "var(--t-text-muted)" }}>
                    {getFeatureLabel("edit_job_date_duration_label")}
                  </span>
                  <span style={{ color: "var(--t-text-primary)" }}>
                    {oldDuration} → <strong>{newDuration}</strong>{" "}
                    {getFeatureLabel("edit_job_date_days_suffix")}
                  </span>
                </div>
              )}

              {/* Exchange — explicit "no duration change" row */}
              {slug === "exchange" && (
                <div
                  className="flex justify-between pt-1.5 border-t"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  <span style={{ color: "var(--t-text-muted)" }}>
                    {getFeatureLabel("edit_job_date_duration_label")}
                  </span>
                  <span style={{ color: "var(--t-text-muted)" }}>
                    {getFeatureLabel("edit_exchange_date_no_duration_change")}
                  </span>
                </div>
              )}

              {/* Phase 2b G1 — pickup auto-vs-override preview.
                  Parity with the rentals-page PickupPreview:
                  shows whether the new date matches the tenant's
                  auto-calculated pickup (base + rental days) or
                  is a manual override, plus the auto value when
                  divergent. Registry keys reused verbatim from
                  the rentals flow (`auto_calculated_with_days`,
                  `rental_rule_override`). */}
              {slug === "pickup" && pickupAutoInfo && (() => {
                const isAuto = newDate === pickupAutoInfo.autoDate;
                const tpl = isAuto
                  ? getFeatureLabel("auto_calculated_with_days")
                  : getFeatureLabel("rental_rule_override");
                const text = tpl
                  .replace("{days}", String(pickupAutoInfo.rentalDays))
                  .replace("{date}", fmtDate(pickupAutoInfo.autoDate));
                return (
                  <div
                    className="flex justify-between pt-1.5 border-t"
                    style={{ borderColor: "var(--t-border)" }}
                  >
                    <span style={{ color: "var(--t-text-muted)" }}>
                      {getFeatureLabel("date_change_preview")}
                    </span>
                    <span
                      style={{
                        color: isAuto
                          ? "var(--t-text-primary)"
                          : "var(--t-warning)",
                      }}
                    >
                      {text}
                    </span>
                  </div>
                );
              })()}

              {/* Manual Override badge */}
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
                  {getFeatureLabel("edit_job_date_manual_override_badge")}
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
            {getFeatureLabel("edit_job_date_cancel_label")}
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
              ? getFeatureLabel("edit_job_date_saving_label")
              : getFeatureLabel("edit_job_date_save_label")}
          </button>
        </div>
      </div>
    </div>
  );
}
