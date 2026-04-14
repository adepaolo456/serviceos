"use client";

/**
 * Phase B13 — Shared Change Pickup Date modal.
 *
 * Used by both the portal dashboard and the rental detail page so the
 * same behavior, validation, and labels are guaranteed across surfaces.
 *
 * This replaces the previous two-option intro (Extend / Request Early
 * Pickup) with a single date picker. Calls
 * `POST /portal/rentals/:id/change-pickup-date` — the canonical route.
 * The legacy `/portal/rentals/:id/extend` route still exists on the API
 * as a backward-compat alias for older portal bundles. The dedicated
 * `/portal/rentals/:id/early-pickup` endpoint also still exists
 * (preserved — no removal), it is simply no longer reachable from the
 * portal UI because the "Request Early Pickup" framing was confusing
 * next to the parent modal title.
 */

import { useEffect, useRef, useState } from "react";
import { portalApi, resolvePortalErrorMessage } from "@/lib/portal-api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { formatRentalTitle } from "@/lib/job-status";

interface RentalLike {
  id: string;
  job_number: string;
  job_type: string;
  service_type?: string;
  status: string;
  asset_subtype?: string | null;
  rental_end_date?: string | null;
  rental_days?: number | null;
}

interface Props<T extends RentalLike> {
  rental: T | null;
  onClose: () => void;
  onSuccess: (updated: Partial<T> & { rental_end_date: string }) => void;
}

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

export default function PortalChangePickupDateModal<T extends RentalLike>({
  rental,
  onClose,
  onSuccess,
}: Props<T>) {
  const [newDate, setNewDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  // Seed the date picker from the current rental end date whenever the
  // modal opens for a new rental.
  useEffect(() => {
    if (rental) setNewDate(rental.rental_end_date || "");
  }, [rental]);

  // Lock body scroll while the modal is mounted so iOS doesn't double-scroll.
  useEffect(() => {
    if (!rental) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [rental]);

  if (!rental) return null;

  const minDate = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const handleSubmit = async () => {
    if (!newDate) return;
    setSubmitting(true);
    try {
      await portalApi.post(`/portal/rentals/${rental.id}/change-pickup-date`, { newEndDate: newDate });
      onSuccess({ ...(rental as Partial<T>), rental_end_date: newDate } as Partial<T> & { rental_end_date: string });
      onClose();
    } catch (err: unknown) {
      alert(resolvePortalErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm min-w-0"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
          {label("portal_action_change_pickup_date", "Change Pickup Date")}
        </h3>
        <p className="text-xs text-[var(--t-text-muted)] mb-4 truncate">
          {formatRentalTitle(rental as unknown as { asset_subtype?: string | null; service_type?: string; job_type: string })} · <span className="font-mono">{rental.job_number}</span>
        </p>

        <div>
          <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
            {label("portal_change_pickup_new_date", "New pickup date")}
          </label>
          <div
            className="relative cursor-pointer mb-4"
            onClick={() => dateInputRef.current?.showPicker?.()}
          >
            <input
              ref={dateInputRef}
              type="date"
              value={newDate}
              min={minDate}
              onChange={e => setNewDate(e.target.value)}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] cursor-pointer"
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]"
          >
            {label("portal_modal_cancel", "Cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!newDate || submitting}
            className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {submitting
              ? label("portal_change_pickup_saving", "Saving…")
              : label("portal_change_pickup_confirm", "Confirm New Date")}
          </button>
        </div>
      </div>
    </div>
  );
}
