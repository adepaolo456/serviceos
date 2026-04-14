"use client";

/**
 * Dedicated Pricing Rules view — extracted from the main Pricing page
 * so the admin surface scales cleanly for tenants with many pricing
 * items, and so the pricing-management UI stays service-type-agnostic
 * for future industries (portable storage, restrooms, equipment).
 *
 * The underlying pricing logic is UNCHANGED — this page reads and
 * writes the same `/pricing` endpoints and the same `pricing_rules`
 * shape that the old big-card grid did. All invoice / billing /
 * customer-facing service descriptions continue to flow through the
 * existing `rule.name` field (auto-generated with the "Dumpster"
 * suffix below) which is deliberately preserved to keep customer-
 * facing labels like "20yd Dumpster Rental" intact on invoices.
 *
 * Admin-UI chrome is registry-driven via `FEATURE_REGISTRY` so that
 * the same pricing-admin surface can support additional service
 * categories without a rewrite.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Search, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { navigateBack } from "@/lib/navigation";

interface PricingRule {
  id: string;
  name: string;
  service_type: string;
  asset_subtype: string;
  customer_type: string | null;
  base_price: number;
  rental_period_days: number;
  extra_day_rate: number;
  included_miles: number;
  per_mile_charge: number;
  max_service_miles: number;
  included_tons: number;
  overage_per_ton: number;
  delivery_fee: number;
  pickup_fee: number;
  exchange_fee: number;
  require_deposit: boolean;
  deposit_amount: number;
  tax_rate: number;
  failed_trip_base_fee: number;
  is_active: boolean;
}

interface PricingResponse {
  data: PricingRule[];
  meta: { total: number };
}

// Labels — registry-driven with generic fallbacks so this screen works
// for tenants that don't have custom copy yet, and so the wording is
// not hardcoded to dumpsters.
const L = {
  pageTitle: () => FEATURE_REGISTRY.pricing_rules_page_title?.label ?? "Pricing Rules",
  pageSubtitle: (n: number) =>
    FEATURE_REGISTRY.pricing_rules_page_subtitle?.shortDescription
      ?? `${n} pricing rule${n === 1 ? "" : "s"} configured`,
  addCta: () => FEATURE_REGISTRY.pricing_rules_add_cta?.label ?? "Add Pricing Rule",
  searchPlaceholder: () =>
    FEATURE_REGISTRY.pricing_rules_search_placeholder?.label
      ?? "Search pricing rules…",
  colName: () => FEATURE_REGISTRY.pricing_rules_col_name?.label ?? "Name",
  colBase: () => FEATURE_REGISTRY.pricing_rules_col_base_price?.label ?? "Base Price",
  colDuration: () => FEATURE_REGISTRY.pricing_rules_col_duration?.label ?? "Duration",
  colIncluded: () => FEATURE_REGISTRY.pricing_rules_col_included_capacity?.label ?? "Included",
  colOverage: () => FEATURE_REGISTRY.pricing_rules_col_overage?.label ?? "Overage",
  colExtraDay: () => FEATURE_REGISTRY.pricing_rules_col_extra_day?.label ?? "Extra Day",
  emptyTitle: () => FEATURE_REGISTRY.pricing_rules_empty_title?.label ?? "No pricing rules yet",
  emptyBody: () =>
    FEATURE_REGISTRY.pricing_rules_empty_body?.shortDescription
      ?? "Add your first pricing rule to start quoting and invoicing.",
  noResults: () =>
    FEATURE_REGISTRY.pricing_rules_no_results?.label ?? "No pricing rules match your search",
  backToPricing: () => FEATURE_REGISTRY.pricing_rules_back_link?.label ?? "Back to Pricing",
  editTitle: (name: string) =>
    `${FEATURE_REGISTRY.pricing_rules_edit_title?.label ?? "Edit"} ${name}`,
  addTitle: () => FEATURE_REGISTRY.pricing_rules_add_title?.label ?? "Add Pricing Rule",
};

export default function PricingRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PricingResponse>("/pricing?limit=100");
      setRules(res.data);
    } catch {
      /* handled by toast elsewhere */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const saveRule = async (data: Record<string, unknown>) => {
    try {
      if (editRule) {
        await api.patch(`/pricing/${editRule.id}`, data);
        toast("success", `${editRule.asset_subtype || "Rule"} pricing updated`);
      } else {
        await api.post("/pricing", {
          serviceType: "dumpster_rental",
          ...data,
        });
        toast("success", `${data.assetSubtype || "New"} pricing created`);
      }
      setEditOpen(false);
      fetchRules();
    } catch {
      toast("error", "Failed to save");
    }
  };

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => {
      return (
        (r.name || "").toLowerCase().includes(q) ||
        (r.asset_subtype || "").toLowerCase().includes(q) ||
        (r.service_type || "").toLowerCase().includes(q)
      );
    });
  }, [rules, searchQuery]);

  return (
    <div>
      {/* History-first back nav — see lib/navigation. */}
      <button
        type="button"
        onClick={() => navigateBack(router, "/pricing")}
        className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> {L.backToPricing()}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
            {L.pageTitle()}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">
            {typeof L.pageSubtitle === "function" ? L.pageSubtitle(rules.length) : L.pageSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setEditRule(null);
              setEditOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> {L.addCta()}
          </button>
        </div>
      </div>

      {/* Controls — search */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--t-text-muted)" }}
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={L.searchPlaceholder()}
            className="w-full rounded-[20px] py-2 pl-9 pr-4 text-sm outline-none"
            style={{
              background: "var(--t-bg-card)",
              border: "1px solid var(--t-border)",
              color: "var(--t-text-primary)",
            }}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 skeleton rounded-[10px]" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div
          className="rounded-[14px] border py-16 flex flex-col items-center justify-center text-center"
          style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)" }}
        >
          <h2
            className="text-[15px] font-semibold mb-1"
            style={{ color: "var(--t-text-primary)" }}
          >
            {L.emptyTitle()}
          </h2>
          <p className="text-[12px] mb-5" style={{ color: "var(--t-text-muted)" }}>
            {L.emptyBody()}
          </p>
          <button
            onClick={() => {
              setEditRule(null);
              setEditOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> {L.addCta()}
          </button>
        </div>
      ) : (
        <div
          className="rounded-[14px] border overflow-hidden"
          style={{
            background: "var(--t-bg-secondary)",
            borderColor: "var(--t-border)",
            boxShadow: "0 2px 12px var(--t-shadow)",
          }}
        >
          <div className="table-scroll">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                  <th
                    className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colName()}
                  </th>
                  <th
                    className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colBase()}
                  </th>
                  <th
                    className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colDuration()}
                  </th>
                  <th
                    className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colIncluded()}
                  </th>
                  <th
                    className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colOverage()}
                  </th>
                  <th
                    className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {L.colExtraDay()}
                  </th>
                  <th className="w-20 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredRules.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-10 text-center text-xs"
                      style={{ color: "var(--t-text-muted)" }}
                    >
                      {L.noResults()}
                    </td>
                  </tr>
                ) : (
                  filteredRules.map((rule, i) => (
                    <tr
                      key={rule.id}
                      onClick={() => {
                        setEditRule(rule);
                        setEditOpen(true);
                      }}
                      className="cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
                      style={{
                        borderBottom:
                          i < filteredRules.length - 1
                            ? "1px solid var(--t-border-subtle)"
                            : "none",
                      }}
                    >
                      <td
                        className="px-5 py-3 font-semibold"
                        style={{ color: "var(--t-text-primary)" }}
                      >
                        {rule.name || rule.asset_subtype || "—"}
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums font-semibold"
                        style={{ color: "var(--t-text-primary)" }}
                      >
                        ${Number(rule.base_price).toLocaleString()}
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums"
                        style={{ color: "var(--t-text-muted)" }}
                      >
                        {rule.rental_period_days} days
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums"
                        style={{ color: "var(--t-text-muted)" }}
                      >
                        {Number(rule.included_tons)} ton{Number(rule.included_tons) !== 1 ? "s" : ""}
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums"
                        style={{ color: "var(--t-accent)" }}
                      >
                        ${Number(rule.overage_per_ton)}/ton
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums"
                        style={{ color: "var(--t-text-muted)" }}
                      >
                        ${Number(rule.extra_day_rate)}/day
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => {
                              setEditRule(rule);
                              setEditOpen(true);
                            }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: "var(--t-text-muted)" }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "var(--t-accent)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--t-text-muted)";
                            }}
                            aria-label="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Delete ${rule.asset_subtype || rule.name} pricing rule? Existing invoices will keep their original pricing.`,
                                )
                              ) {
                                return;
                              }
                              try {
                                await api.delete(`/pricing/${rule.id}`);
                                toast("success", "Pricing rule deleted");
                                fetchRules();
                              } catch {
                                toast("error", "Failed to delete");
                              }
                            }}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: "var(--t-text-muted)" }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "var(--t-error)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--t-text-muted)";
                            }}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Pricing SlideOver */}
      <SlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={
          editRule
            ? L.editTitle(editRule.name || editRule.asset_subtype || "")
            : L.addTitle()
        }
      >
        <PricingForm
          rule={editRule}
          onSave={saveRule}
          onClose={() => setEditOpen(false)}
        />
      </SlideOver>
    </div>
  );
}

/* ── Pricing Edit Form ── */
function PricingForm({
  rule,
  onSave,
  onClose,
}: {
  rule: PricingRule | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [ruleIdentifier, setRuleIdentifier] = useState(rule?.asset_subtype || "");
  const [basePrice, setBasePrice] = useState(rule ? String(Number(rule.base_price)) : "");
  const [includedTons, setIncludedTons] = useState(
    rule ? String(Number(rule.included_tons)) : "",
  );
  const [overageRate, setOverageRate] = useState(
    rule ? String(Number(rule.overage_per_ton)) : "",
  );
  const [rentalDays, setRentalDays] = useState(rule ? String(rule.rental_period_days) : "14");
  const [extraDayRate, setExtraDayRate] = useState(
    rule ? String(Number(rule.extra_day_rate)) : "",
  );
  const [identifierError, setIdentifierError] = useState("");
  const inputStyle = {
    background: "var(--t-bg-card)",
    borderColor: "var(--t-border)",
    color: "var(--t-text-primary)",
  };

  const fields = [
    {
      label: FEATURE_REGISTRY.pricing_rules_field_base_price?.label ?? "Base Price",
      value: basePrice,
      set: setBasePrice,
      prefix: "$",
      suffix: undefined,
    },
    {
      label:
        FEATURE_REGISTRY.pricing_rules_field_included_capacity?.label ?? "Included Tonnage",
      value: includedTons,
      set: setIncludedTons,
      prefix: undefined,
      suffix: "tons",
    },
    {
      label: FEATURE_REGISTRY.pricing_rules_field_overage?.label ?? "Overage Rate",
      value: overageRate,
      set: setOverageRate,
      prefix: "$",
      suffix: "/ton",
    },
    {
      label: FEATURE_REGISTRY.pricing_rules_field_duration?.label ?? "Rental Period",
      value: rentalDays,
      set: setRentalDays,
      prefix: undefined,
      suffix: "days",
    },
    {
      label: FEATURE_REGISTRY.pricing_rules_field_extra_day?.label ?? "Extra Day Rate",
      value: extraDayRate,
      set: setExtraDayRate,
      prefix: "$",
      suffix: "/day",
    },
  ];

  const identifierLabel =
    FEATURE_REGISTRY.pricing_rules_field_identifier?.label ?? "Rule Identifier";
  const identifierPlaceholder =
    FEATURE_REGISTRY.pricing_rules_field_identifier_placeholder?.label
      ?? "e.g. 10yd, 20yd, 30yd";

  return (
    <div className="space-y-5">
      {/* Rule identifier — required. Stored in pricing_rules.asset_subtype
          and invoice descriptions are built as `${asset_subtype} Dumpster
          Rental` in invoices/[id]/page.tsx, so this value flows into
          customer-facing billing labels and must not be empty. */}
      <div>
        <label
          className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
          style={{ color: "var(--t-text-muted)" }}
        >
          {identifierLabel}{" "}
          <span style={{ color: "var(--t-error, #ef4444)" }}>*</span>
        </label>
        <input
          value={ruleIdentifier}
          onChange={(e) => {
            setRuleIdentifier(e.target.value);
            setIdentifierError("");
          }}
          placeholder={identifierPlaceholder}
          className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
          style={{
            ...inputStyle,
            borderColor: identifierError ? "var(--t-error, #ef4444)" : inputStyle.borderColor,
          }}
        />
        {identifierError && (
          <p className="mt-1 text-xs" style={{ color: "var(--t-error, #ef4444)" }}>
            {identifierError}
          </p>
        )}
      </div>

      {fields.map((field) => (
        <div key={field.label}>
          <label
            className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
            style={{ color: "var(--t-text-muted)" }}
          >
            {field.label}
          </label>
          <div className="relative">
            {field.prefix && (
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: "var(--t-text-muted)" }}
              >
                {field.prefix}
              </span>
            )}
            <input
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              type="number"
              className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
              style={{
                ...inputStyle,
                paddingLeft: field.prefix ? 28 : 16,
              }}
            />
            {field.suffix && (
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: "var(--t-text-muted)" }}
              >
                {field.suffix}
              </span>
            )}
          </div>
        </div>
      ))}

      <div className="flex gap-3 pt-4">
        <button
          onClick={() => {
            const trimmed = ruleIdentifier.trim();
            if (!trimmed) {
              setIdentifierError(
                FEATURE_REGISTRY.pricing_rules_field_identifier_required?.label
                  ?? "Rule identifier is required",
              );
              return;
            }
            // IMPORTANT — `name` is the pricing rule's display string and
            // is consumed by invoice generation (`${rule.asset_subtype}
            // Dumpster Rental` and related copy in invoices/[id]/page.tsx).
            // Changing the generated value here would silently alter every
            // new invoice's service description. The user's explicit
            // instructions require preserving existing customer-facing
            // labels, so the "Dumpster" suffix stays as today's tenant
            // default. A future multi-industry configuration pass should
            // move this to a per-tenant service-type setting — do NOT
            // try to do that in this refactor.
            onSave({
              name: `${trimmed} Dumpster`,
              assetSubtype: trimmed,
              basePrice: Number(basePrice),
              includedTons: Number(includedTons),
              overagePerTon: Number(overageRate),
              rentalPeriodDays: Number(rentalDays),
              extraDayRate: Number(extraDayRate),
            });
          }}
          className="flex-1 rounded-full py-3 text-[13px] font-bold"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
        >
          Save
        </button>
        <button
          onClick={onClose}
          className="rounded-full px-6 py-3 text-[13px] font-medium border"
          style={{
            borderColor: "var(--t-border)",
            color: "var(--t-text-muted)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
