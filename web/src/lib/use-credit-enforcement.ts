"use client";

/**
 * Phase 4 — Credit-control: booking-flow enforcement hook.
 *
 * Single source of truth for "is the operator allowed to book a job
 * for this customer right now, and if not, what's the path forward?".
 * Used by the BookingWizard and the customer-first booking form.
 *
 * Data sources (read-only — never mutates customer/policy state):
 *   - GET /customers/:id/credit-state         (Phase 2)
 *   - GET /tenant-settings/credit-policy      (Phase 2)
 *   - GET /auth/profile                       (existing)
 *
 * The hook:
 *   1. Fetches all three on customer change. Re-evaluates live —
 *      no persistent enforcement state, no polling, no caching
 *      across customers (each customer gets a fresh fetch).
 *   2. Combines `hold.reasons[]` with the per-rule policy mode
 *      (`warn` vs `block`) to compute one of:
 *        - 'normal' → booking proceeds
 *        - 'warn'   → banner shown, booking proceeds
 *        - 'block'  → banner shown, submit disabled (override possible if eligible)
 *        - 'unknown' → no customer / fetch failed → no enforcement (fail open)
 *   3. Tracks the override state inside the hook so consumers don't
 *      re-implement the override flow. Override is gated on:
 *        - state === 'block'
 *        - tenant policy `allow_office_override === true`
 *        - user role in ('admin', 'owner')
 *
 * Phase 4B — backend is now server-authoritative. Consumers should
 * forward `enforcement.overrideReason` to the booking POST body as
 * `creditOverride: { reason }`. The backend builds the audit note
 * from JWT user + ISO timestamp and writes it to the new job's
 * placement_notes inside the same transaction as the booking.
 * The hook no longer exposes a `buildOverrideNote()` helper —
 * client-side note construction was a Phase 4A artifact.
 *
 * Multi-tenant safety: every fetch uses existing tenant-scoped
 * endpoints. The hook never receives or sends a tenant ID.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

/* ─── Types mirroring the Phase 2 API contracts ─── */

export type HoldReason =
  | { type: "manual_hold"; set_by: string | null; set_at: string | null; reason: string | null }
  | { type: "credit_limit_exceeded"; limit: number; current_ar: number }
  | { type: "overdue_threshold_exceeded"; threshold_days: number; oldest_past_due_days: number };

interface CustomerCreditState {
  customer_id: string;
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
  // Other fields are returned by the API but not consumed by this hook.
  // Keep the type narrow so the hook doesn't accidentally drift onto
  // unrelated state.
}

interface CreditPolicyMode {
  enabled: boolean;
  mode?: "warn" | "block";
  days_overdue?: number;
  threshold?: number;
}

interface CreditPolicy {
  default_payment_terms?: string;
  default_credit_limit?: number | null;
  ar_threshold_block?: CreditPolicyMode;
  overdue_block?: CreditPolicyMode;
  unpaid_exceptions_block?: CreditPolicyMode;
  allow_office_override?: boolean;
}

interface Profile {
  id: string;
  role: string;
}

/* ─── Hook return shape ─── */

export type EnforcementState = "loading" | "normal" | "warn" | "block" | "unknown";

export interface UseCreditEnforcementResult {
  /** Discriminated state — drives the banner rendering and submit gating. */
  state: EnforcementState;
  /** Structured reasons from the credit-state endpoint, unchanged. */
  reasons: HoldReason[];
  /** Whether the operator can override given current role + policy. */
  canOverride: boolean;
  /** True when an override has been applied for this customer in this session. */
  overrideActive: boolean;
  /** The reason text the operator typed when applying the override. */
  overrideReason: string;
  /** Apply an override with the given reason. Caller must validate non-empty. */
  applyOverride: (reason: string) => void;
  /** Discard an applied override (e.g., when the customer changes). */
  clearOverride: () => void;
  /**
   * Should the parent component disable its primary submit CTA?
   * True when state === 'block' AND no override is active.
   */
  shouldBlockSubmit: boolean;
  /** True while any of the three required fetches are in flight. */
  loading: boolean;
  /** Force a refetch (e.g., after the operator opens a new customer). */
  refetch: () => void;
}

/* ─── Internal helpers ─── */

/**
 * Per-reason → policy-mode resolver.
 *
 * `manual_hold` always counts as block (operator-set holds bypass
 * tenant policy modes — they're explicit). For policy-driven reasons
 * we look up the corresponding rule's `mode` field. Default to `warn`
 * when the rule has no mode set, mirroring the safest interpretation.
 */
function reasonMode(reason: HoldReason, policy: CreditPolicy): "warn" | "block" {
  switch (reason.type) {
    case "manual_hold":
      return "block";
    case "credit_limit_exceeded":
      return policy.ar_threshold_block?.mode === "block" ? "block" : "warn";
    case "overdue_threshold_exceeded":
      return policy.overdue_block?.mode === "block" ? "block" : "warn";
    default:
      // Defensive: an unknown reason type defaults to warn so we don't
      // hard-block on something the frontend doesn't understand.
      return "warn";
  }
}

/* ─── Hook ─── */

export function useCreditEnforcement(
  customerId: string | null | undefined,
): UseCreditEnforcementResult {
  const [creditState, setCreditState] = useState<CustomerCreditState | null>(null);
  const [policy, setPolicy] = useState<CreditPolicy | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  // Override is per-customer — clearing on customer change keeps the
  // operator from accidentally re-applying an old override to a new
  // booking. Tracked here so the parent can read `overrideActive`
  // without managing its own state.
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideActive, setOverrideActive] = useState(false);
  // Used by the refetch helper to bust the cache without changing
  // customerId externally.
  const [refetchKey, setRefetchKey] = useState(0);

  // Profile + policy are fetched once per hook instance and cached in
  // refs so subsequent customer changes don't re-fetch them. The hook
  // is mounted once per BookingWizard session, so this matches the
  // spec's "single fetch per booking flow" requirement.
  const profileLoaded = useRef(false);
  const policyLoaded = useRef(false);

  // Reset override state whenever the customer changes — never carry
  // an override across customers. The wizard re-evaluates from
  // scratch.
  useEffect(() => {
    setOverrideActive(false);
    setOverrideReason("");
    setCreditState(null);
    setFetchError(false);
  }, [customerId]);

  // Fetch profile + policy once per hook instance.
  useEffect(() => {
    if (!profileLoaded.current) {
      profileLoaded.current = true;
      api
        .get<Profile>("/auth/profile")
        .then(setProfile)
        .catch(() => setProfile(null));
    }
    if (!policyLoaded.current) {
      policyLoaded.current = true;
      api
        .get<CreditPolicy>("/tenant-settings/credit-policy")
        .then(setPolicy)
        .catch(() => setPolicy({}));
    }
  }, []);

  // Fetch credit-state on customer change (or refetch trigger).
  useEffect(() => {
    if (!customerId) {
      setCreditState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<CustomerCreditState>(`/customers/${customerId}/credit-state`)
      .then((data) => {
        if (cancelled) return;
        setCreditState(data);
        setFetchError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchError(true);
        setCreditState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, refetchKey]);

  /* ─── Derived state ─── */

  const state: EnforcementState = useMemo(() => {
    if (!customerId) return "unknown";
    if (loading || !policy) return "loading";
    if (fetchError || !creditState) {
      // Fail open: if credit-state fetch failed, don't block bookings.
      // The operator should still be able to book — the alternative
      // (blocking on transient API failure) is a worse outcome.
      return "unknown";
    }
    if (!creditState.hold.effective_active) return "normal";

    // Hold is active — determine warn vs block by aggregating each
    // reason's mode.
    const reasons = creditState.hold.reasons;
    const anyBlock = reasons.some((r) => reasonMode(r, policy) === "block");
    return anyBlock ? "block" : "warn";
  }, [customerId, loading, policy, fetchError, creditState]);

  const reasons = creditState?.hold.reasons ?? [];

  const canOverride = useMemo(() => {
    if (state !== "block") return false;
    if (!policy?.allow_office_override) return false;
    if (!profile) return false;
    return profile.role === "admin" || profile.role === "owner";
  }, [state, policy, profile]);

  const shouldBlockSubmit = state === "block" && !overrideActive;

  const applyOverride = useCallback((reason: string) => {
    setOverrideReason(reason);
    setOverrideActive(true);
  }, []);

  const clearOverride = useCallback(() => {
    setOverrideReason("");
    setOverrideActive(false);
  }, []);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  return {
    state,
    reasons,
    canOverride,
    overrideActive,
    overrideReason,
    applyOverride,
    clearOverride,
    shouldBlockSubmit,
    loading,
    refetch,
  };
}
