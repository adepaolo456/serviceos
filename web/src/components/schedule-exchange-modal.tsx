"use client";

/**
 * Phase 4b-extract — shared Schedule Exchange modal.
 *
 * Single component handles both flows previously implemented
 * inline on `/rentals/[id]`:
 *   - create → POST /rental-chains/:chainId/exchanges
 *   - edit   → PATCH /rental-chains/:chainId/exchanges/:linkId
 *
 * Extracted so a future Job Detail entry point (Phase 4b-
 * jobdetail-create) can mount the same component without
 * duplicating validation, pricing-fetch, or submit logic.
 *
 * Preserves the rentals-page behavior byte-for-byte:
 *   - same validation rules + same registry error copy
 *   - same POST/PATCH payloads + same endpoints
 *   - same lazy /pricing fetch in create mode (one-shot on mount)
 *   - same "current size forced into options" fallback when the
 *     chain's current dumpster size was deactivated in pricing
 *   - same auto-vs-override pickup preview
 *
 * `broadcastLifecycleChange(chainId)` fires from inside the
 * success branch so parents cannot forget the cross-tab /
 * cross-surface invariant (matches the Phase 2b EditJobDateModal
 * pattern).
 *
 * `LifecycleDateInput`, `PickupPreview`, and `shiftDays` are
 * inlined here as byte-for-byte copies of the rentals-page
 * versions. A cross-modal primitives consolidation is a future
 * task — do not expand scope here.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { broadcastLifecycleChange } from "@/lib/lifecycle-sync";

// ─────────────────────────────────────────────────────────────
// Local helpers — inlined copies of the rentals-page versions.
// These are intentionally NOT shared across modal files in this
// extraction pass to keep scope tight. If a later pass
// consolidates modal primitives, the rentals-page copies and
// these can merge.
// ─────────────────────────────────────────────────────────────

function shiftDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function interp(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function LifecycleDateInput({
  value,
  onChange,
  min,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type="date"
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      onClick={() => {
        try {
          ref.current?.showPicker?.();
        } catch {
          /* Unsupported browser — native click already handled */
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          try {
            ref.current?.showPicker?.();
          } catch {
            /* ignore */
          }
        }
      }}
      className={className}
    />
  );
}

function PickupPreview({
  label,
  autoDate,
  overrideDate,
  rentalDays,
}: {
  label?: string;
  autoDate: string | null;
  overrideDate?: string | null;
  rentalDays: number;
}) {
  const actual = overrideDate || autoDate;
  if (!actual) return null;
  const isAuto = !overrideDate || overrideDate === autoDate;
  const autoSuffixTpl =
    FEATURE_REGISTRY.auto_calculated_with_days?.label ?? "Auto ({days}-day rental)";
  const overrideSuffixTpl =
    FEATURE_REGISTRY.rental_rule_override?.label ?? "Override — auto would be {date}";
  const headerLabel =
    label ?? FEATURE_REGISTRY.date_change_preview?.label ?? "New pickup date will be:";
  return (
    <div className="mt-1 mb-3 flex items-start gap-1.5">
      <div className="flex-1 text-[11px] text-[var(--t-text-muted)] leading-relaxed">
        <span>{headerLabel}</span>{" "}
        <span className="font-semibold text-[var(--t-text-primary)]">
          {fmtShortDate(actual)}
        </span>{" "}
        <span>
          ({isAuto
            ? interp(autoSuffixTpl, { days: rentalDays })
            : interp(overrideSuffixTpl, { date: fmtShortDate(autoDate || "") })})
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export type ScheduleExchangeModalProps =
  | {
      mode: "create";
      /** Rental chain id — used for POST path + broadcast signal. */
      chainId: string;
      /** Chain drop_off_date (YYYY-MM-DD) — validates exchange_date >= deliveryDate. */
      deliveryDate: string;
      /** Tenant-configured rental duration — drives the auto-vs-override pickup preview. */
      tenantRentalDays: number;
      /** Chain's current dumpster size — pre-fills the size picker and is
       *  forced into the options list when it has been deactivated in pricing. */
      currentDumpsterSize: string;
      onClose: () => void;
      /** Parent's refresh hook. Called AFTER broadcast + BEFORE onClose. */
      onSuccess: () => void;
    }
  | {
      mode: "edit";
      chainId: string;
      deliveryDate: string;
      tenantRentalDays: number;
      /** task_chain_links.id being rescheduled — PATCH path param. */
      linkId: string;
      /** Current scheduled_date of the exchange link (YYYY-MM-DD) — pre-fill. */
      currentExchangeDate: string;
      onClose: () => void;
      onSuccess: () => void;
    };

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function ScheduleExchangeModal(props: ScheduleExchangeModalProps) {
  // Initial date seed — create uses today (matches the rentals-page
  // trigger's prior behavior); edit uses the current scheduled_date.
  const initialDate =
    props.mode === "create"
      ? new Date().toISOString().split("T")[0]
      : props.currentExchangeDate;

  const [exchangeDate, setExchangeDate] = useState(initialDate);
  const [overridePickup, setOverridePickup] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Create-only state.
  const [exchangeSize, setExchangeSize] = useState<string>(
    props.mode === "create" ? props.currentDumpsterSize || "" : "",
  );
  const [availableSizes, setAvailableSizes] = useState<string[] | null>(null);
  const [sizesLoading, setSizesLoading] = useState(false);

  // Lazy pricing fetch — create mode only. Fires once on mount; the
  // rentals-page behavior is preserved (deactivated sizes never
  // appear; the chain's current size is force-injected below so a
  // rental on a deactivated size can still be exchanged).
  useEffect(() => {
    if (props.mode !== "create") return;
    if (availableSizes !== null || sizesLoading) return;
    setSizesLoading(true);
    api
      .get<{ data: Array<{ asset_subtype: string }> }>("/pricing?limit=100")
      .then((res) => {
        const uniq = Array.from(
          new Set(
            (res.data || [])
              .map((p) => p.asset_subtype)
              .filter((s): s is string => typeof s === "string" && s.length > 0),
          ),
        );
        setAvailableSizes(uniq);
      })
      .catch(() => setAvailableSizes([]))
      .finally(() => setSizesLoading(false));
  }, [props.mode, availableSizes, sizesLoading]);

  const handleSubmit = async () => {
    if (!exchangeDate) return;
    // Validation — byte-for-byte preserved from rentals-page
    // handlers (handleScheduleExchange / handleExchangeReschedule).
    if (props.deliveryDate && exchangeDate < props.deliveryDate) {
      setError(
        FEATURE_REGISTRY.validation_exchange_before_delivery?.label ??
          "Exchange date cannot be before delivery date",
      );
      return;
    }
    if (overridePickup && overridePickup <= exchangeDate) {
      setError(
        FEATURE_REGISTRY.validation_pickup_before_exchange?.label ??
          "Pickup date cannot be before exchange date",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (props.mode === "create") {
        await api.post(`/rental-chains/${props.chainId}/exchanges`, {
          exchange_date: exchangeDate,
          ...(exchangeSize ? { dumpster_size: exchangeSize } : {}),
          ...(overridePickup ? { override_pickup_date: overridePickup } : {}),
        });
      } else {
        await api.patch(
          `/rental-chains/${props.chainId}/exchanges/${props.linkId}`,
          {
            exchange_date: exchangeDate,
            ...(overridePickup ? { override_pickup_date: overridePickup } : {}),
          },
        );
      }
      // Broadcast first, then parent refresh, then close — matches
      // the rentals-page sequence: setXxx(null) → broadcast → reload.
      broadcastLifecycleChange(props.chainId);
      props.onSuccess();
      props.onClose();
    } catch (err: unknown) {
      // Modal stays open on error so the operator can retry without
      // losing input. Fallback copy differs per mode (matches the
      // original handlers exactly).
      const fallback =
        props.mode === "create"
          ? "Failed to schedule exchange"
          : "Failed to update lifecycle";
      setError(
        err instanceof Error
          ? err.message
          : FEATURE_REGISTRY.lifecycle_update_error?.label ?? fallback,
      );
    } finally {
      setSaving(false);
    }
  };

  const headerLabel =
    props.mode === "create"
      ? FEATURE_REGISTRY.schedule_exchange?.label ?? "Schedule Exchange"
      : FEATURE_REGISTRY.edit_exchange_date?.label ?? "Edit Exchange Date";

  const subtitleLabel =
    props.mode === "create"
      ? FEATURE_REGISTRY.schedule_exchange_description?.label ??
        "Swap the dumpster on this rental. A new pickup is automatically scheduled based on your tenant's default rental period."
      : FEATURE_REGISTRY.edit_exchange_date_description?.label ??
        "Reschedule this exchange. The downstream pickup is recalculated from your tenant rental period unless you override it.";

  // Size-picker options (create only). Current size is forced into
  // the list so a rental on a recently-deactivated size can still
  // be exchanged — mirrors rentals/[id]/page.tsx lines 931-938.
  const sizeOptionData = (() => {
    if (props.mode !== "create") return null;
    const currentSize = props.currentDumpsterSize || "";
    const baseList = availableSizes ?? [];
    const hasCurrent = currentSize && baseList.includes(currentSize);
    const options = hasCurrent || !currentSize ? baseList : [currentSize, ...baseList];
    const isEmpty = !sizesLoading && options.length === 0;
    return { options, isEmpty };
  })();

  const disableConfirm =
    !exchangeDate || saving || (props.mode === "create" && !exchangeSize);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={props.onClose}
    >
      <div
        className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
          {headerLabel}
        </h3>
        <p className="text-xs text-[var(--t-text-muted)] mb-4">{subtitleLabel}</p>

        {/* Exchange date */}
        <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
          {FEATURE_REGISTRY.exchange_date?.label ?? "Exchange date"}
        </label>
        <LifecycleDateInput
          value={exchangeDate}
          onChange={(v) => {
            setExchangeDate(v);
            setError("");
          }}
          min={props.deliveryDate || undefined}
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
        />

        {/* Size picker — create only */}
        {props.mode === "create" && sizeOptionData && (
          <>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.new_dumpster_size?.label ?? "New dumpster size"}
            </label>
            <select
              value={exchangeSize}
              onChange={(e) => setExchangeSize(e.target.value)}
              disabled={sizesLoading || sizeOptionData.isEmpty}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1 disabled:opacity-50"
            >
              {sizesLoading && (
                <option value="">
                  {FEATURE_REGISTRY.select_dumpster_size_loading?.label ?? "Loading sizes…"}
                </option>
              )}
              {!sizesLoading && sizeOptionData.isEmpty && (
                <option value="">
                  {FEATURE_REGISTRY.no_available_sizes?.label ?? "No active sizes available"}
                </option>
              )}
              {!sizesLoading && !sizeOptionData.isEmpty && (
                <>
                  {!exchangeSize && (
                    <option value="" disabled>
                      {FEATURE_REGISTRY.select_dumpster_size?.label ?? "Select a size"}
                    </option>
                  )}
                  {sizeOptionData.options.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </>
              )}
            </select>
            <p className="text-[10px] text-[var(--t-text-muted)] mb-3">
              {sizeOptionData.isEmpty
                ? FEATURE_REGISTRY.no_available_sizes_hint?.label ??
                  "Add an active pricing rule to enable exchanges."
                : FEATURE_REGISTRY.new_dumpster_size_hint?.label ??
                  "Pre-filled with the current rental size."}
            </p>
          </>
        )}

        {/* Override pickup */}
        <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
          {FEATURE_REGISTRY.override_pickup_date?.label ?? "Override pickup date (optional)"}
        </label>
        <LifecycleDateInput
          value={overridePickup}
          onChange={(v) => {
            setOverridePickup(v);
            setError("");
          }}
          min={exchangeDate || undefined}
          className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1"
        />
        <p className="text-[10px] text-[var(--t-text-muted)] mb-1">
          {FEATURE_REGISTRY.override_pickup_date_hint?.label ??
            "Leave blank to auto-calculate from your tenant rental period."}
        </p>

        {/* Auto-vs-override preview */}
        {exchangeDate && (
          <PickupPreview
            autoDate={shiftDays(exchangeDate, props.tenantRentalDays)}
            overrideDate={overridePickup || undefined}
            rentalDays={props.tenantRentalDays}
          />
        )}

        {/* Error banner — preserved byte-for-byte from rentals page */}
        {error && <p className="text-xs text-[var(--t-error)] mb-3">{error}</p>}

        {/* Actions. "Cancel" is hardcoded to match byte-for-byte
            parity with the rentals-page modals (no registry entry
            exists today for this surface; adding one is out of scope
            per this phase's "no new registry entries" rule). */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={props.onClose}
            className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={disableConfirm}
            className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving
              ? FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving..."
              : FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
