"use client";

/**
 * Phase 4 — Credit-control: booking-flow enforcement banner.
 *
 * Renders inside the BookingWizard and the customer-first booking
 * form. Visualizes the output of `useCreditEnforcement` and provides
 * the inline override flow.
 *
 * Three rendered states:
 *   - state === 'normal' / 'unknown' / 'loading' → renders nothing
 *   - state === 'warn'  → yellow banner, booking proceeds
 *   - state === 'block' → red banner, override-eligible operators see
 *                         an inline "Override & Continue" panel
 *
 * Once an override is applied, the banner switches to a green
 * confirmation card showing the applied reason with a "Cancel
 * override" link. The parent submit button is then re-enabled by
 * `useCreditEnforcement.shouldBlockSubmit` flipping to false.
 *
 * All user-facing labels resolve through FEATURE_REGISTRY with
 * defensive `??` fallbacks. No hardcoded copy.
 */

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import {
  type HoldReason,
  type UseCreditEnforcementResult,
} from "@/lib/use-credit-enforcement";

function labelFor(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const HOLD_REASON_LABEL_KEYS: Record<HoldReason["type"], string> = {
  manual_hold: "customer_credit_hold_reason_manual",
  credit_limit_exceeded: "customer_credit_hold_reason_credit_limit_exceeded",
  overdue_threshold_exceeded: "customer_credit_hold_reason_overdue_threshold",
};

function holdReasonLabel(t: HoldReason["type"]): string {
  return labelFor(HOLD_REASON_LABEL_KEYS[t], t);
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export interface CreditEnforcementBannerProps {
  enforcement: UseCreditEnforcementResult;
}

export function CreditEnforcementBanner({ enforcement }: CreditEnforcementBannerProps) {
  const {
    state,
    reasons,
    canOverride,
    overrideActive,
    overrideReason,
    applyOverride,
    clearOverride,
  } = enforcement;

  const [overrideInput, setOverrideInput] = useState("");
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [error, setError] = useState("");

  // No banner when there's nothing to surface (loading, no customer,
  // normal state, fetch failed → fail open).
  if (state === "loading" || state === "unknown" || state === "normal") {
    return null;
  }

  // Override applied — green confirmation card.
  if (overrideActive) {
    return (
      <div
        className="rounded-[14px] border-l-4 px-4 py-3 mb-4"
        style={{
          background: "var(--t-accent-soft)",
          borderColor: "var(--t-accent)",
          borderTop: "1px solid var(--t-border)",
          borderRight: "1px solid var(--t-border)",
          borderBottom: "1px solid var(--t-border)",
        }}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--t-accent)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                {labelFor("booking_credit_override_applied", "Credit hold override applied")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--t-text-secondary)" }}>
                {labelFor("booking_credit_override_reason_prefix", "Reason")}: {overrideReason}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--t-text-muted)" }}>
                {labelFor(
                  "booking_credit_override_audit_notice",
                  "This override will be recorded on the new job's notes for audit.",
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearOverride();
              setShowOverrideForm(false);
              setOverrideInput("");
              setError("");
            }}
            className="text-xs underline shrink-0"
            style={{ color: "var(--t-text-muted)" }}
          >
            {labelFor("booking_credit_override_cancel", "Cancel override")}
          </button>
        </div>
      </div>
    );
  }

  const isWarn = state === "warn";
  const accent = isWarn ? "var(--t-warning)" : "var(--t-error)";
  const accentSoft = isWarn ? "var(--t-warning-soft)" : "var(--t-error-soft)";
  const headerLabelKey = isWarn ? "booking_credit_warn_header" : "booking_credit_block_header";
  const headerFallback = isWarn ? "Customer credit warning" : "Customer on hold";

  const handleSubmitOverride = () => {
    const trimmed = overrideInput.trim();
    if (!trimmed) {
      setError(
        labelFor("booking_credit_override_reason_required", "A reason is required to override."),
      );
      return;
    }
    applyOverride(trimmed);
    setShowOverrideForm(false);
    setOverrideInput("");
    setError("");
  };

  return (
    <div
      className="rounded-[14px] border-l-4 px-4 py-3 mb-4"
      style={{
        background: accentSoft,
        borderColor: accent,
        borderTop: "1px solid var(--t-border)",
        borderRight: "1px solid var(--t-border)",
        borderBottom: "1px solid var(--t-border)",
      }}
      role="alert"
    >
      <div className="flex items-start gap-2">
        {isWarn ? (
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: accent }} />
        ) : (
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" style={{ color: accent }} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {labelFor(headerLabelKey, headerFallback)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--t-text-secondary)" }}>
            {isWarn
              ? labelFor(
                  "booking_credit_warn_body",
                  "This customer has an active credit warning. You may proceed.",
                )
              : labelFor(
                  "booking_credit_block_body",
                  "Booking is blocked while this customer is on credit hold.",
                )}
          </p>

          {/* Structured reason cards */}
          <ul className="mt-2 space-y-1.5">
            {reasons.map((reason, idx) => (
              <li
                key={idx}
                className="rounded-[10px] border px-3 py-2 text-xs"
                style={{
                  borderColor: "var(--t-border)",
                  background: "var(--t-bg-card)",
                  color: "var(--t-text-secondary)",
                }}
              >
                <p className="font-semibold" style={{ color: "var(--t-text-primary)" }}>
                  {holdReasonLabel(reason.type)}
                </p>
                {reason.type === "manual_hold" && (
                  <div className="mt-0.5 space-y-0.5" style={{ color: "var(--t-text-muted)" }}>
                    {reason.reason && <p>Reason: {reason.reason}</p>}
                    {(reason.set_by || reason.set_at) && (
                      <p>
                        Set
                        {reason.set_by ? ` by ${reason.set_by}` : ""}
                        {reason.set_at ? ` on ${new Date(reason.set_at).toLocaleString()}` : ""}
                      </p>
                    )}
                  </div>
                )}
                {reason.type === "credit_limit_exceeded" && (
                  <p className="mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                    Limit {fmtCurrency(reason.limit)} · Current AR {fmtCurrency(reason.current_ar)}
                  </p>
                )}
                {reason.type === "overdue_threshold_exceeded" && (
                  <p className="mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                    Threshold {reason.threshold_days}d · Oldest past due {reason.oldest_past_due_days}d
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Override CTA — only when blocked + permitted */}
          {state === "block" && canOverride && !showOverrideForm && (
            <button
              type="button"
              onClick={() => {
                setShowOverrideForm(true);
                setError("");
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
            >
              <Lock className="h-3 w-3" />
              {labelFor("booking_credit_override_cta", "Override & Continue")}
            </button>
          )}

          {/* Inline override form */}
          {state === "block" && canOverride && showOverrideForm && (
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
                {labelFor("booking_credit_override_reason_label", "Override reason (required)")}
              </label>
              <textarea
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                rows={3}
                placeholder={labelFor(
                  "booking_credit_override_reason_placeholder",
                  "Why are you overriding this credit hold? Recorded as part of the audit trail.",
                )}
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none focus:border-[var(--t-accent)] resize-none"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
              {error && (
                <p className="text-xs" style={{ color: "var(--t-error)" }}>
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmitOverride}
                  disabled={!overrideInput.trim()}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                >
                  {labelFor("booking_credit_override_confirm", "Confirm override")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOverrideForm(false);
                    setOverrideInput("");
                    setError("");
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                >
                  {labelFor("booking_credit_override_cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Non-eligible block — explain the operator can't override */}
          {state === "block" && !canOverride && (
            <p className="mt-3 text-[11px]" style={{ color: "var(--t-text-muted)" }}>
              {labelFor(
                "booking_credit_override_not_permitted",
                "This block cannot be overridden from your account. Contact an administrator.",
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
