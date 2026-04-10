"use client";

/**
 * Phase 3 — Credit-control: customer detail Accounting & Credit panel.
 *
 * Visibility-only surface — does NOT trigger any enforcement. Calls
 * the existing Phase 2 endpoints:
 *   - GET    /customers/:id/credit-state
 *   - PATCH  /customers/:id/credit-settings  (admin/owner)
 *   - POST   /customers/:id/credit-hold       (admin/owner)
 *   - DELETE /customers/:id/credit-hold       (admin/owner)
 *
 * The panel is rendered inside the Billing tab on the customer detail
 * page. It is fully self-contained: it fetches its own credit-state
 * + the user profile, gates inline edit affordances on the role, and
 * never reaches into parent state.
 *
 * All user-facing labels resolve through FEATURE_REGISTRY with
 * defensive `??` fallbacks. No hardcoded copy.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Lock,
  Pencil,
  ShieldAlert,
  Unlock,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

const fmt = (n: number | null | undefined) => formatCurrency((n ?? 0) as number);

/* ─── Types mirroring the Phase 2 API contract ─── */

type EffectiveSource = "customer_override" | "tenant_default" | "app_default" | "none";

type PaymentTerms =
  | "due_on_receipt"
  | "cod"
  | "net_7"
  | "net_15"
  | "net_30"
  | "net_60"
  | "custom";

type HoldReason =
  | { type: "manual_hold"; set_by: string | null; set_at: string | null; reason: string | null }
  | { type: "credit_limit_exceeded"; limit: number; current_ar: number }
  | { type: "overdue_threshold_exceeded"; threshold_days: number; oldest_past_due_days: number };

interface CustomerCreditState {
  customer_id: string;
  tenant_id: string;
  computed_at: string;
  receivable: {
    total_open_ar: number;
    open_invoice_count: number;
    has_open_receivables: boolean;
  };
  past_due: {
    total_past_due_ar: number;
    past_due_invoice_count: number;
    oldest_past_due_days: number | null;
  };
  credit: {
    effective_limit: number | null;
    available_credit: number | null;
    limit_exceeded: boolean;
    no_limit_configured: boolean;
    source: EffectiveSource;
  };
  payment_terms: {
    effective: PaymentTerms;
    source: EffectiveSource;
  };
  hold: {
    manual_active: boolean;
    policy_active: boolean;
    effective_active: boolean;
    reasons: HoldReason[];
    manual_metadata: {
      reason: string | null;
      set_by: string | null;
      set_at: string | null;
      released_by: string | null;
      released_at: string | null;
    } | null;
  };
}

interface Profile {
  id: string;
  role: string;
}

const PAYMENT_TERMS_OPTIONS: PaymentTerms[] = [
  "due_on_receipt",
  "cod",
  "net_7",
  "net_15",
  "net_30",
  "net_60",
  "custom",
];

/* ─── Registry label helpers ─── */

function labelFor(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const PAYMENT_TERMS_LABEL_KEYS: Record<PaymentTerms, string> = {
  due_on_receipt: "payment_terms_due_on_receipt",
  cod: "payment_terms_cod",
  net_7: "payment_terms_net_7",
  net_15: "payment_terms_net_15",
  net_30: "payment_terms_net_30",
  net_60: "payment_terms_net_60",
  custom: "payment_terms_custom",
};

const SOURCE_LABEL_KEYS: Record<EffectiveSource, string> = {
  customer_override: "credit_source_customer_override",
  tenant_default: "credit_source_tenant_default",
  app_default: "credit_source_app_default",
  none: "credit_source_none",
};

const HOLD_REASON_LABEL_KEYS: Record<HoldReason["type"], string> = {
  manual_hold: "customer_credit_hold_reason_manual",
  credit_limit_exceeded: "customer_credit_hold_reason_credit_limit_exceeded",
  overdue_threshold_exceeded: "customer_credit_hold_reason_overdue_threshold",
};

function paymentTermsLabel(t: PaymentTerms): string {
  return labelFor(PAYMENT_TERMS_LABEL_KEYS[t], t);
}

function sourceLabel(s: EffectiveSource): string {
  return labelFor(SOURCE_LABEL_KEYS[s], s);
}

function holdReasonLabel(t: HoldReason["type"]): string {
  return labelFor(HOLD_REASON_LABEL_KEYS[t], t);
}

/* ─── Component ─── */

export interface CustomerCreditPanelProps {
  customerId: string;
}

export function CustomerCreditPanel({ customerId }: CustomerCreditPanelProps) {
  const { toast } = useToast();
  const [state, setState] = useState<CustomerCreditState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.get<CustomerCreditState>(`/customers/${customerId}/credit-state`);
      setState(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadState();
    api
      .get<Profile>("/auth/profile")
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [loadState]);

  const canEdit = profile?.role === "admin" || profile?.role === "owner";

  /* ─── Loading + failure states ─── */

  if (loading && !state) {
    return (
      <div
        className="rounded-[20px] border p-5 mb-4"
        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
      >
        <div className="h-4 w-48 rounded bg-[var(--t-bg-elevated)] animate-pulse mb-3" />
        <div className="h-24 w-full rounded bg-[var(--t-bg-elevated)] animate-pulse" />
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div
        className="rounded-[20px] border-l-4 px-5 py-4 mb-4"
        style={{
          background: "var(--t-error-soft)",
          borderColor: "var(--t-error)",
          borderTop: "1px solid var(--t-border)",
          borderRight: "1px solid var(--t-border)",
          borderBottom: "1px solid var(--t-border)",
        }}
        role="alert"
      >
        <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
          Couldn’t load accounting state
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--t-text-secondary)" }}>
          The credit-state endpoint did not respond. Try refreshing the page.
        </p>
      </div>
    );
  }

  /* ─── Visual state ─── */

  // Critical when effective hold is active. Warning when AR exceeds
  // credit limit (but no hold yet) OR there is past-due balance.
  // Otherwise neutral.
  const isCritical = state.hold.effective_active;
  const isWarning =
    !isCritical &&
    (state.credit.limit_exceeded || state.past_due.total_past_due_ar > 0);

  const accentColor = isCritical
    ? "var(--t-error)"
    : isWarning
      ? "var(--t-warning)"
      : "var(--t-border)";
  const accentBg = isCritical
    ? "var(--t-error-soft)"
    : isWarning
      ? "var(--t-warning-soft)"
      : "var(--t-bg-card)";

  const panelTitle = labelFor("customer_credit_panel", "Accounting & Credit");

  return (
    <div
      className="rounded-[20px] border-l-4 mb-4"
      style={{
        background: "var(--t-bg-card)",
        borderColor: accentColor,
        borderTop: "1px solid var(--t-border)",
        borderRight: "1px solid var(--t-border)",
        borderBottom: "1px solid var(--t-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: "1px solid var(--t-border)" }}
      >
        <div className="flex items-center gap-2">
          {isCritical ? (
            <ShieldAlert className="h-4 w-4" style={{ color: "var(--t-error)" }} />
          ) : isWarning ? (
            <AlertTriangle className="h-4 w-4" style={{ color: "var(--t-warning)" }} />
          ) : (
            <CircleDollarSign className="h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
          )}
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--t-text-primary)" }}
            title={FEATURE_REGISTRY.customer_credit_panel?.shortDescription}
          >
            {panelTitle}
          </h3>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}
              title={FEATURE_REGISTRY.customer_credit_action_edit_settings?.shortDescription}
            >
              <Pencil className="h-3 w-3" />
              {labelFor("customer_credit_action_edit_settings", "Edit credit settings")}
            </button>
            {state.hold.manual_active ? (
              <button
                type="button"
                onClick={() => setHoldOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
                title={FEATURE_REGISTRY.customer_credit_action_release_hold?.shortDescription}
              >
                <Unlock className="h-3 w-3" />
                {labelFor("customer_credit_action_release_hold", "Release credit hold")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setHoldOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                title={FEATURE_REGISTRY.customer_credit_action_set_hold?.shortDescription}
              >
                <Lock className="h-3 w-3" />
                {labelFor("customer_credit_action_set_hold", "Set credit hold")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4" style={{ background: accentBg }}>
        {/* Financial Summary — 3 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat
            label={labelFor("customer_credit_field_total_open_ar", "Open AR")}
            value={fmt(state.receivable.total_open_ar)}
            sub={`${state.receivable.open_invoice_count} invoice${state.receivable.open_invoice_count !== 1 ? "s" : ""}`}
          />
          <Stat
            label={labelFor("customer_credit_field_total_past_due", "Past Due")}
            value={fmt(state.past_due.total_past_due_ar)}
            sub={`${state.past_due.past_due_invoice_count} invoice${state.past_due.past_due_invoice_count !== 1 ? "s" : ""}`}
            valueColor={state.past_due.total_past_due_ar > 0 ? "var(--t-warning)" : undefined}
          />
          <Stat
            label={labelFor("customer_credit_field_oldest_past_due", "Oldest Past Due")}
            value={
              state.past_due.oldest_past_due_days !== null
                ? `${state.past_due.oldest_past_due_days}d`
                : labelFor("customer_credit_no_past_due", "None")
            }
            valueColor={
              state.past_due.oldest_past_due_days !== null && state.past_due.oldest_past_due_days >= 30
                ? "var(--t-error)"
                : state.past_due.oldest_past_due_days !== null
                  ? "var(--t-warning)"
                  : undefined
            }
          />
        </div>

        {/* Payment Terms + Credit Limit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KeyValue
            label={labelFor("customer_credit_field_payment_terms", "Payment Terms")}
            value={paymentTermsLabel(state.payment_terms.effective)}
            sub={sourceLabel(state.payment_terms.source)}
          />
          <KeyValue
            label={labelFor("customer_credit_field_credit_limit", "Credit Limit")}
            value={
              state.credit.no_limit_configured
                ? labelFor("customer_credit_no_limit_configured", "No limit configured")
                : fmt(state.credit.effective_limit)
            }
            sub={
              state.credit.no_limit_configured
                ? sourceLabel(state.credit.source)
                : `${labelFor("customer_credit_field_available_credit", "Available Credit")}: ${fmt(state.credit.available_credit)} · ${sourceLabel(state.credit.source)}`
            }
            warning={state.credit.limit_exceeded}
          />
        </div>

        {/* Hold State */}
        <div
          className="rounded-[14px] border px-4 py-3"
          style={{
            background: state.hold.effective_active ? "var(--t-error-soft)" : "var(--t-bg-card)",
            borderColor: state.hold.effective_active ? "var(--t-error)" : "var(--t-border)",
          }}
        >
          <div className="flex items-center gap-2">
            {state.hold.effective_active ? (
              <Lock className="h-4 w-4" style={{ color: "var(--t-error)" }} />
            ) : (
              <CheckCircle2 className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
            )}
            <p
              className="text-sm font-semibold"
              style={{
                color: state.hold.effective_active ? "var(--t-error)" : "var(--t-text-primary)",
              }}
            >
              {labelFor("customer_credit_field_hold_status", "Hold Status")}:{" "}
              {state.hold.effective_active
                ? labelFor("customer_credit_hold_active", "On Hold")
                : labelFor("customer_credit_hold_inactive", "No Hold")}
            </p>
          </div>

          {/* Hold reasons (when active) */}
          {state.hold.reasons.length > 0 && (
            <ul className="mt-3 space-y-2">
              {state.hold.reasons.map((reason, idx) => (
                <li key={idx} className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
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
                      Limit {fmt(reason.limit)} · Current AR {fmt(reason.current_ar)}
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
          )}

          {/* Manual hold history when not active but history exists */}
          {!state.hold.effective_active && state.hold.manual_metadata && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--t-text-muted)" }}>
              Last released
              {state.hold.manual_metadata.released_at
                ? ` on ${new Date(state.hold.manual_metadata.released_at).toLocaleDateString()}`
                : ""}
              {state.hold.manual_metadata.released_by
                ? ` by ${state.hold.manual_metadata.released_by}`
                : ""}
            </p>
          )}
        </div>
      </div>

      {/* Edit settings drawer */}
      <EditCreditSettingsDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customerId={customerId}
        currentPaymentTerms={
          state.payment_terms.source === "customer_override"
            ? state.payment_terms.effective
            : null
        }
        currentCreditLimit={
          state.credit.source === "customer_override" ? state.credit.effective_limit : null
        }
        onSaved={() => {
          loadState();
          toast("success", "Credit settings updated");
        }}
      />

      {/* Set / release hold drawer */}
      <CreditHoldDrawer
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        customerId={customerId}
        isCurrentlyOnHold={state.hold.manual_active}
        onSaved={(action) => {
          loadState();
          toast(
            "success",
            action === "set" ? "Credit hold set" : "Credit hold released",
          );
        }}
      />
    </div>
  );
}

/* ─── Stat / KeyValue helpers (local presentational components) ─── */

function Stat({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div
      className="rounded-[12px] border px-3 py-2"
      style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
        {label}
      </p>
      <p
        className="mt-1 text-lg font-bold tabular-nums"
        style={{ color: valueColor ?? "var(--t-text-primary)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function KeyValue({
  label,
  value,
  sub,
  warning = false,
}: {
  label: string;
  value: string;
  sub?: string;
  warning?: boolean;
}) {
  return (
    <div
      className="rounded-[12px] border px-3 py-2"
      style={{
        borderColor: warning ? "var(--t-warning)" : "var(--t-border)",
        background: warning ? "var(--t-warning-soft)" : "var(--t-bg-card)",
      }}
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
        {label}
      </p>
      <p
        className="mt-1 text-sm font-semibold"
        style={{ color: warning ? "var(--t-warning)" : "var(--t-text-primary)" }}
      >
        {value}
        {warning && (
          <AlertCircle
            className="inline-block h-3.5 w-3.5 ml-1.5"
            style={{ color: "var(--t-warning)" }}
          />
        )}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ─── Edit credit settings drawer ─── */

function EditCreditSettingsDrawer({
  open,
  onClose,
  customerId,
  currentPaymentTerms,
  currentCreditLimit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  currentPaymentTerms: PaymentTerms | null;
  currentCreditLimit: number | null;
  onSaved: () => void;
}) {
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms | "" >(currentPaymentTerms ?? "");
  const [creditLimit, setCreditLimit] = useState<string>(
    currentCreditLimit !== null ? String(currentCreditLimit) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPaymentTerms(currentPaymentTerms ?? "");
      setCreditLimit(currentCreditLimit !== null ? String(currentCreditLimit) : "");
      setError("");
    }
  }, [open, currentPaymentTerms, currentCreditLimit]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body: { payment_terms?: PaymentTerms | null; credit_limit?: number | null } = {};
      // Only include fields that changed; pass null to clear an override.
      if (paymentTerms !== (currentPaymentTerms ?? "")) {
        body.payment_terms = paymentTerms === "" ? null : paymentTerms;
      }
      const trimmedLimit = creditLimit.trim();
      const newLimitValue = trimmedLimit === "" ? null : Number(trimmedLimit);
      if (
        (currentCreditLimit === null && newLimitValue !== null) ||
        (currentCreditLimit !== null && newLimitValue !== currentCreditLimit)
      ) {
        if (newLimitValue !== null && (Number.isNaN(newLimitValue) || newLimitValue < 0)) {
          throw new Error("Credit limit must be a non-negative number.");
        }
        body.credit_limit = newLimitValue;
      }
      if (Object.keys(body).length === 0) {
        // Nothing to do — close the drawer without firing a request.
        onClose();
        return;
      }
      await api.patch(`/customers/${customerId}/credit-settings`, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update credit settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Edit credit settings">
      <div className="space-y-5">
        {error && (
          <div
            className="rounded-[16px] px-4 py-3 text-sm"
            style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}
          >
            {error}
          </div>
        )}

        <div>
          <label
            className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: "var(--t-text-muted)" }}
          >
            {labelFor("customer_credit_field_payment_terms", "Payment Terms")}
          </label>
          <select
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value as PaymentTerms | "")}
            className="w-full rounded-[12px] border px-4 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-border)",
              color: "var(--t-text-primary)",
            }}
          >
            <option value="">— Use tenant default —</option>
            {PAYMENT_TERMS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {paymentTermsLabel(opt)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: "var(--t-text-muted)" }}
          >
            {labelFor("customer_credit_field_credit_limit", "Credit Limit")}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            placeholder="(leave blank for tenant default)"
            className="w-full rounded-[12px] border px-4 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-border)",
              color: "var(--t-text-primary)",
            }}
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
        >
          {saving ? "Saving…" : "Save credit settings"}
        </button>
      </div>
    </SlideOver>
  );
}

/* ─── Set / release credit hold drawer ─── */

function CreditHoldDrawer({
  open,
  onClose,
  customerId,
  isCurrentlyOnHold,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  isCurrentlyOnHold: boolean;
  onSaved: (action: "set" | "release") => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  const handleSet = async () => {
    if (!reason.trim()) {
      setError("Hold reason is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customerId}/credit-hold`, { reason: reason.trim() });
      onSaved("set");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set credit hold");
    } finally {
      setSaving(false);
    }
  };

  const handleRelease = async () => {
    setSaving(true);
    setError("");
    try {
      await api.delete(`/customers/${customerId}/credit-hold`);
      onSaved("release");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release credit hold");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isCurrentlyOnHold ? "Release credit hold" : "Set credit hold"}
    >
      <div className="space-y-5">
        {error && (
          <div
            className="rounded-[16px] px-4 py-3 text-sm"
            style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}
          >
            {error}
          </div>
        )}

        {isCurrentlyOnHold ? (
          <>
            <p className="text-sm" style={{ color: "var(--t-text-secondary)" }}>
              Releasing the credit hold stamps your user as the releaser and timestamps the
              release. The original set_by / set_at / reason stay intact for forensic history.
            </p>
            <button
              type="button"
              onClick={handleRelease}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
            >
              <Unlock className="h-4 w-4" />
              {saving ? "Releasing…" : "Release credit hold"}
            </button>
          </>
        ) : (
          <>
            <div>
              <label
                className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                Reason (required)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="Why is this hold being set? Saved as part of the audit trail."
                className="w-full rounded-[12px] border px-4 py-2.5 text-sm outline-none focus:border-[var(--t-accent)] resize-none"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleSet}
              disabled={saving || !reason.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
            >
              <Lock className="h-4 w-4" />
              {saving ? "Setting…" : "Set credit hold"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-full border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </SlideOver>
  );
}
