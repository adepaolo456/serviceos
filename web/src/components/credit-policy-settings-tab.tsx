"use client";

/**
 * Phase 3 — Credit-control: Tenant Settings → Credit Policy tab.
 *
 * Visibility-only — does NOT trigger any enforcement. Calls the
 * existing Phase 2 endpoints:
 *   - GET    /tenant-settings/credit-policy
 *   - PATCH  /tenant-settings/credit-policy   (admin/owner)
 *
 * The form is partial — only fields that change get sent. Empty
 * fields fall back to the system default. The PATCH preserves any
 * fields not present in the request.
 *
 * All user-facing labels resolve through FEATURE_REGISTRY with
 * defensive `??` fallbacks. No hardcoded copy.
 */

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

const PAYMENT_TERMS_OPTIONS = [
  "due_on_receipt",
  "cod",
  "net_7",
  "net_15",
  "net_30",
  "net_60",
  "custom",
] as const;

type PaymentTerms = (typeof PAYMENT_TERMS_OPTIONS)[number];
type PolicyMode = "warn" | "block";

interface RuleShape {
  enabled: boolean;
  mode?: PolicyMode;
  threshold?: number;
  days_overdue?: number;
}

interface DispatchEnforcement {
  enabled: boolean;
  block_on_hold: boolean;
  block_actions: {
    assignment: boolean;
    en_route: boolean;
    arrived: boolean;
    completed: boolean;
  };
  allow_override: boolean;
  override_roles: string[];
  require_override_reason: boolean;
}

const DEFAULT_DISPATCH_ENFORCEMENT: DispatchEnforcement = {
  enabled: false,
  block_on_hold: false,
  block_actions: { assignment: false, en_route: false, arrived: false, completed: false },
  allow_override: true,
  override_roles: ["owner", "admin"],
  require_override_reason: true,
};

interface CreditPolicy {
  default_payment_terms?: PaymentTerms;
  default_credit_limit?: number | null;
  ar_threshold_block?: RuleShape;
  overdue_block?: RuleShape;
  unpaid_exceptions_block?: RuleShape;
  allow_office_override?: boolean;
  dispatch_enforcement?: DispatchEnforcement;
}

interface Profile {
  id: string;
  role: string;
}

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

function paymentTermsLabel(t: PaymentTerms): string {
  return labelFor(PAYMENT_TERMS_LABEL_KEYS[t], t);
}

const inputCls =
  "w-full rounded-[12px] border px-4 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]";
const inputStyle = {
  background: "var(--t-bg-card)",
  borderColor: "var(--t-border)",
  color: "var(--t-text-primary)",
} as React.CSSProperties;

const labelCls =
  "block text-xs uppercase tracking-wider font-semibold mb-1.5";
const labelStyle = { color: "var(--t-text-muted)" } as React.CSSProperties;

export interface CreditPolicySettingsTabProps {
  profile: Profile | null;
}

export function CreditPolicySettingsTab({ profile }: CreditPolicySettingsTabProps) {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<CreditPolicy>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Local form state — distinct from `policy` so unsaved edits don't
  // interfere with the optimistic display.
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState<PaymentTerms | "">("");
  const [defaultCreditLimit, setDefaultCreditLimit] = useState<string>("");
  const [overdueRule, setOverdueRule] = useState<RuleShape>({ enabled: false });
  const [arRule, setArRule] = useState<RuleShape>({ enabled: false });
  const [exceptionsRule, setExceptionsRule] = useState<RuleShape>({ enabled: false });
  const [allowOverride, setAllowOverride] = useState<boolean>(false);
  const [dispatchEnforcement, setDispatchEnforcement] = useState<DispatchEnforcement>({ ...DEFAULT_DISPATCH_ENFORCEMENT });

  const canEdit = profile?.role === "admin" || profile?.role === "owner";

  useEffect(() => {
    let cancelled = false;
    api
      .get<CreditPolicy>("/tenant-settings/credit-policy")
      .then((p) => {
        if (cancelled) return;
        setPolicy(p);
        setDefaultPaymentTerms(p.default_payment_terms ?? "");
        setDefaultCreditLimit(
          p.default_credit_limit !== undefined && p.default_credit_limit !== null
            ? String(p.default_credit_limit)
            : "",
        );
        setOverdueRule(p.overdue_block ?? { enabled: false });
        setArRule(p.ar_threshold_block ?? { enabled: false });
        setExceptionsRule(p.unpaid_exceptions_block ?? { enabled: false });
        setAllowOverride(!!p.allow_office_override);
        setDispatchEnforcement({ ...DEFAULT_DISPATCH_ENFORCEMENT, ...p.dispatch_enforcement, block_actions: { ...DEFAULT_DISPATCH_ENFORCEMENT.block_actions, ...p.dispatch_enforcement?.block_actions } });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const limitValue =
        defaultCreditLimit.trim() === "" ? null : Number(defaultCreditLimit);
      if (limitValue !== null && (Number.isNaN(limitValue) || limitValue < 0)) {
        toast("error", "Default credit limit must be a non-negative number.");
        setSaving(false);
        return;
      }
      const body: CreditPolicy = {
        default_payment_terms: defaultPaymentTerms === "" ? undefined : defaultPaymentTerms,
        default_credit_limit: limitValue,
        ar_threshold_block: arRule,
        overdue_block: overdueRule,
        unpaid_exceptions_block: exceptionsRule,
        allow_office_override: allowOverride,
        dispatch_enforcement: dispatchEnforcement,
      };
      const next = await api.patch<CreditPolicy>("/tenant-settings/credit-policy", body);
      setPolicy(next);
      toast("success", "Credit policy saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save credit policy");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <div className="h-4 w-48 rounded bg-[var(--t-bg-elevated)] animate-pulse mb-3" />
        <div className="h-32 w-full rounded bg-[var(--t-bg-elevated)] animate-pulse" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="rounded-[20px] border-l-4 px-5 py-4"
        style={{
          background: "var(--t-error-soft)",
          borderColor: "var(--t-error)",
          borderTop: "1px solid var(--t-border)",
          borderRight: "1px solid var(--t-border)",
          borderBottom: "1px solid var(--t-border)",
        }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
          Couldn’t load credit policy
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-[20px] border p-5"
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
    >
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: "var(--t-text-primary)" }}>
          {labelFor("tenant_credit_policy_section", "Credit Policy")}
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--t-text-muted)" }}>
          {FEATURE_REGISTRY.tenant_credit_policy_section?.shortDescription ??
            "Tenant-wide credit policy configuration."}
        </p>
      </div>

      {/* Visibility-only disclaimer */}
      <div
        className="mb-5 rounded-[14px] border-l-4 px-4 py-3 flex items-start gap-2"
        style={{
          background: "var(--t-warning-soft)",
          borderColor: "var(--t-warning)",
          borderTop: "1px solid var(--t-border)",
          borderRight: "1px solid var(--t-border)",
          borderBottom: "1px solid var(--t-border)",
        }}
      >
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--t-warning)" }} />
        <p className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
          {labelFor(
            "tenant_credit_policy_visibility_only_notice",
            "Visibility only — enforcement not active yet.",
          )}
        </p>
      </div>

      {/* Defaults */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className={labelCls} style={labelStyle}>
            {labelFor("tenant_credit_policy_field_default_payment_terms", "Default Payment Terms")}
          </label>
          <select
            value={defaultPaymentTerms}
            onChange={(e) => setDefaultPaymentTerms(e.target.value as PaymentTerms | "")}
            disabled={!canEdit}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">— No default —</option>
            {PAYMENT_TERMS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {paymentTermsLabel(opt)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} style={labelStyle}>
            {labelFor("tenant_credit_policy_field_default_credit_limit", "Default Credit Limit")}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={defaultCreditLimit}
            onChange={(e) => setDefaultCreditLimit(e.target.value)}
            disabled={!canEdit}
            placeholder="(no default)"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Rules */}
      <RuleEditor
        title={labelFor("tenant_credit_policy_field_overdue_block", "Past Due Threshold Block")}
        rule={overdueRule}
        onChange={setOverdueRule}
        showDays
        canEdit={canEdit}
      />
      <RuleEditor
        title={labelFor("tenant_credit_policy_field_ar_threshold_block", "Credit Limit Block")}
        rule={arRule}
        onChange={setArRule}
        canEdit={canEdit}
      />
      <RuleEditor
        title={labelFor("tenant_credit_policy_field_unpaid_exceptions", "Unpaid Exceptions Block")}
        rule={exceptionsRule}
        onChange={setExceptionsRule}
        canEdit={canEdit}
      />

      {/* Override toggle */}
      <div className="mt-4 mb-5 flex items-center gap-3">
        <input
          id="credit-policy-allow-override"
          type="checkbox"
          checked={allowOverride}
          onChange={(e) => setAllowOverride(e.target.checked)}
          disabled={!canEdit}
          className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
        />
        <label
          htmlFor="credit-policy-allow-override"
          className="text-sm cursor-pointer"
          style={{ color: "var(--t-text-primary)" }}
        >
          {labelFor("tenant_credit_policy_field_allow_office_override", "Allow Office Override")}
        </label>
      </div>

      {/* Dispatch enforcement (Phase 5) */}
      <div
        className="rounded-[14px] border px-4 py-4 mb-5 mt-2"
        style={{ borderColor: "var(--t-border)", background: "var(--t-bg-elevated, var(--t-bg-card))" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            id="dispatch-enforcement-enabled"
            type="checkbox"
            checked={dispatchEnforcement.enabled}
            onChange={(e) => setDispatchEnforcement((prev) => ({ ...prev, enabled: e.target.checked }))}
            disabled={!canEdit}
            className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
          />
          <label htmlFor="dispatch-enforcement-enabled" className="text-sm font-semibold cursor-pointer" style={{ color: "var(--t-text-primary)" }}>
            {labelFor("dispatch_enforcement_enabled", "Enable dispatch enforcement")}
          </label>
        </div>
        {dispatchEnforcement.enabled && (
          <div className="ml-6 space-y-3">
            <div className="flex items-center gap-2">
              <input
                id="dispatch-block-on-hold"
                type="checkbox"
                checked={dispatchEnforcement.block_on_hold}
                onChange={(e) => setDispatchEnforcement((prev) => ({ ...prev, block_on_hold: e.target.checked }))}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
              />
              <label htmlFor="dispatch-block-on-hold" className="text-sm cursor-pointer" style={{ color: "var(--t-text-primary)" }}>
                {labelFor("dispatch_enforcement_block_on_hold", "Block dispatch actions when customer is on hold")}
              </label>
            </div>
            {dispatchEnforcement.block_on_hold && (
              <div className="ml-6 space-y-2">
                <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>Blocked actions</p>
                {([
                  ["assignment", "dispatch_enforcement_action_assignment", "Block driver assignment"],
                  ["en_route", "dispatch_enforcement_action_en_route", "Block en route"],
                  ["arrived", "dispatch_enforcement_action_arrived", "Block arrived"],
                  ["completed", "dispatch_enforcement_action_completed", "Block completed"],
                ] as const).map(([key, regId, fallback]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={dispatchEnforcement.block_actions[key]}
                      onChange={(e) =>
                        setDispatchEnforcement((prev) => ({
                          ...prev,
                          block_actions: { ...prev.block_actions, [key]: e.target.checked },
                        }))
                      }
                      disabled={!canEdit}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--t-accent)]"
                    />
                    <span className="text-xs" style={{ color: "var(--t-text-primary)" }}>
                      {labelFor(regId, fallback)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                id="dispatch-allow-override"
                type="checkbox"
                checked={dispatchEnforcement.allow_override}
                onChange={(e) => setDispatchEnforcement((prev) => ({ ...prev, allow_override: e.target.checked }))}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
              />
              <label htmlFor="dispatch-allow-override" className="text-sm cursor-pointer" style={{ color: "var(--t-text-primary)" }}>
                {labelFor("dispatch_enforcement_allow_override", "Allow dispatch override")}
              </label>
            </div>
            {dispatchEnforcement.allow_override && (
              <div className="ml-6 flex items-center gap-2">
                <input
                  id="dispatch-require-reason"
                  type="checkbox"
                  checked={dispatchEnforcement.require_override_reason}
                  onChange={(e) => setDispatchEnforcement((prev) => ({ ...prev, require_override_reason: e.target.checked }))}
                  disabled={!canEdit}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--t-accent)]"
                />
                <label htmlFor="dispatch-require-reason" className="text-xs cursor-pointer" style={{ color: "var(--t-text-primary)" }}>
                  {labelFor("dispatch_enforcement_require_reason", "Require override reason")}
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save */}
      {canEdit && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
        >
          {saving ? "Saving…" : "Save credit policy"}
        </button>
      )}
      {!canEdit && (
        <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
          Read-only — admin or owner role required to edit.
        </p>
      )}
    </div>
  );
}

/* ─── RuleEditor — small reusable rule row ─── */

function RuleEditor({
  title,
  rule,
  onChange,
  showDays = false,
  canEdit,
}: {
  title: string;
  rule: RuleShape;
  onChange: (next: RuleShape) => void;
  showDays?: boolean;
  canEdit: boolean;
}) {
  return (
    <div
      className="rounded-[14px] border px-4 py-3 mb-3"
      style={{ borderColor: "var(--t-border)", background: "var(--t-bg-elevated, var(--t-bg-card))" }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!rule.enabled}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
            disabled={!canEdit}
            className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
          />
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showDays && rule.enabled && (
            <input
              type="number"
              min="0"
              value={rule.days_overdue ?? ""}
              onChange={(e) =>
                onChange({
                  ...rule,
                  days_overdue: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              disabled={!canEdit}
              placeholder="days"
              className="w-20 rounded-[10px] border px-2 py-1.5 text-xs outline-none focus:border-[var(--t-accent)]"
              style={inputStyle}
            />
          )}
          {rule.enabled && (
            <select
              value={rule.mode ?? "warn"}
              onChange={(e) =>
                onChange({ ...rule, mode: e.target.value as PolicyMode })
              }
              disabled={!canEdit}
              className="rounded-[10px] border px-2 py-1.5 text-xs outline-none focus:border-[var(--t-accent)]"
              style={inputStyle}
            >
              <option value="warn">{labelFor("tenant_credit_policy_mode_warn", "Warn")}</option>
              <option value="block">{labelFor("tenant_credit_policy_mode_block", "Block")}</option>
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
