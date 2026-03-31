"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, DollarSign, Mail } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";

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

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);
  // Quote state
  const [quoteSize, setQuoteSize] = useState<string>("");
  const [quoteAddress, setQuoteAddress] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [quoteEmail, setQuoteEmail] = useState("");
  const [quotePhone, setQuotePhone] = useState("");
  const [quoteSending, setQuoteSending] = useState(false);
  const { toast } = useToast();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PricingResponse>("/pricing?limit=100");
      setRules(res.data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const selectedRule = rules.find((r) => r.asset_subtype === quoteSize);

  const saveRule = async (data: Partial<PricingRule>) => {
    if (!editRule) return;
    try {
      await api.patch(`/pricing/${editRule.id}`, data);
      toast("success", `${editRule.asset_subtype} pricing updated`);
      setEditOpen(false);
      fetchRules();
    } catch {
      toast("error", "Failed to save");
    }
  };

  const sendQuote = async () => {
    if (!selectedRule || !quoteEmail) return;
    setQuoteSending(true);
    try {
      await api.post("/quotes", {
        customerName: quoteName,
        customerEmail: quoteEmail,
        customerPhone: quotePhone,
        deliveryAddress: quoteAddress ? { street: quoteAddress } : null,
        assetSubtype: quoteSize,
        basePrice: Number(selectedRule.base_price),
        includedTons: Number(selectedRule.included_tons),
        rentalDays: selectedRule.rental_period_days,
        overageRate: Number(selectedRule.overage_per_ton),
        extraDayRate: Number(selectedRule.extra_day_rate),
      });
      toast("success", `Quote emailed to ${quoteEmail}`);
      setQuoteName("");
      setQuoteEmail("");
      setQuotePhone("");
      setQuoteAddress("");
      setQuoteSize("");
    } catch {
      toast("error", "Failed to send quote");
    } finally {
      setQuoteSending(false);
    }
  };

  return (
    <div>
      {/* Header on dark frame */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--t-frame-text)" }}
          >
            Pricing
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--t-frame-text-muted)" }}
          >
            {rules.length} pricing rules
          </p>
        </div>
        <button
          onClick={() => {
            setEditRule(null);
            setEditOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
          style={{ background: "var(--t-accent)", color: "#000" }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Size
        </button>
      </div>

      {/* Compact pricing tiles — grid like dashboard KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 skeleton rounded-[20px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {rules.map((rule) => (
            <button
              key={rule.id}
              onClick={() => {
                setEditRule(rule);
                setEditOpen(true);
              }}
              className="text-left rounded-[20px] border p-5 transition-all duration-150 cursor-pointer hover:-translate-y-0.5"
              style={{
                background: "var(--t-bg-secondary)",
                borderColor: "var(--t-border)",
                boxShadow: "0 2px 12px var(--t-shadow)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 6px 20px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  "0 2px 12px var(--t-shadow)";
              }}
            >
              <p
                className="text-[11px] font-extrabold uppercase tracking-[1.2px]"
                style={{ color: "var(--t-text-tertiary)" }}
              >
                {rule.asset_subtype?.replace("yd", " Yard") || rule.name}
              </p>
              <p
                className="text-[28px] font-extrabold tracking-tight mt-1"
                style={{
                  color: "var(--t-text-primary)",
                  letterSpacing: "-1px",
                }}
              >
                ${Number(rule.base_price).toLocaleString()}
              </p>
              <p
                className="text-[12px] mt-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                {Number(rule.included_tons)} ton
                {Number(rule.included_tons) !== 1 ? "s" : ""} ·{" "}
                {rule.rental_period_days} days · $
                {Number(rule.extra_day_rate)}/day
              </p>
              <p
                className="text-[11px] mt-1 font-semibold"
                style={{ color: "var(--t-accent)" }}
              >
                ${Number(rule.overage_per_ton)}/ton overage
              </p>
            </button>
          ))}
          {/* Add new size card */}
          <button
            onClick={() => {
              setEditRule(null);
              setEditOpen(true);
            }}
            className="rounded-[20px] border border-dashed p-5 transition-all duration-150 flex flex-col items-center justify-center cursor-pointer"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
              minHeight: 120,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--t-accent)";
              e.currentTarget.style.color = "var(--t-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--t-border)";
              e.currentTarget.style.color = "var(--t-text-muted)";
            }}
          >
            <Plus className="h-6 w-6 mb-1" />
            <span className="text-xs font-semibold">Add Size</span>
          </button>
        </div>
      )}

      {/* Quick Quote section */}
      <div className="mt-10">
        <p
          className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-1"
          style={{ color: "var(--t-frame-text-muted)" }}
        >
          QUICK QUOTE
        </p>
        <p
          className="text-[14px] mb-4"
          style={{ color: "var(--t-frame-text-muted)" }}
        >
          Generate an instant quote for phone inquiries
        </p>

        <div
          className="rounded-[20px] border p-6"
          style={{
            background: "var(--t-bg-secondary)",
            borderColor: "var(--t-border)",
            boxShadow: "0 2px 12px var(--t-shadow)",
          }}
        >
          {/* Size selector pills */}
          <div className="mb-5">
            <p
              className="text-[12px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "var(--t-text-muted)" }}
            >
              Dumpster Size
            </p>
            <div className="flex flex-wrap gap-2">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => setQuoteSize(rule.asset_subtype)}
                  className="rounded-full px-4 py-2.5 text-[13px] font-bold transition-all duration-150 border"
                  style={{
                    background:
                      quoteSize === rule.asset_subtype
                        ? "var(--t-accent)"
                        : "var(--t-bg-secondary)",
                    color:
                      quoteSize === rule.asset_subtype
                        ? "#000"
                        : "var(--t-text-primary)",
                    borderColor:
                      quoteSize === rule.asset_subtype
                        ? "var(--t-accent)"
                        : "var(--t-border)",
                  }}
                >
                  {rule.asset_subtype} — ${Number(rule.base_price)}
                </button>
              ))}
            </div>
          </div>

          {/* Form fields in a grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label
                className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                Delivery Address
              </label>
              <input
                value={quoteAddress}
                onChange={(e) => setQuoteAddress(e.target.value)}
                placeholder="Address or ZIP code"
                className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
            </div>
            <div>
              <label
                className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                Customer Name
              </label>
              <input
                value={quoteName}
                onChange={(e) => setQuoteName(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
            </div>
            <div>
              <label
                className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                Email
              </label>
              <input
                value={quoteEmail}
                onChange={(e) => setQuoteEmail(e.target.value)}
                placeholder="For emailing the quote"
                type="email"
                className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
            </div>
            <div>
              <label
                className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: "var(--t-text-muted)" }}
              >
                Phone
              </label>
              <input
                value={quotePhone}
                onChange={(e) => setQuotePhone(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                }}
              />
            </div>
          </div>

          {/* Quote result — appears when size selected */}
          {selectedRule && (
            <div
              className="rounded-[20px] border-l-4 p-5 mb-5 animate-fade-in"
              style={{
                background: "var(--t-bg-card)",
                borderColor: "var(--t-accent)",
                borderTop: "1px solid var(--t-border)",
                borderRight: "1px solid var(--t-border)",
                borderBottom: "1px solid var(--t-border)",
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <p
                  className="text-[15px] font-bold"
                  style={{ color: "var(--t-text-primary)" }}
                >
                  {selectedRule.asset_subtype?.replace("yd", " Yard")} Dumpster
                </p>
                <p
                  className="text-[24px] font-extrabold tracking-tight"
                  style={{ color: "var(--t-accent)" }}
                >
                  ${Number(selectedRule.base_price).toLocaleString()}
                </p>
              </div>
              <div
                className="space-y-1.5 text-[13px]"
                style={{ color: "var(--t-text-muted)" }}
              >
                <div className="flex justify-between">
                  <span>Includes</span>
                  <span style={{ color: "var(--t-text-primary)" }}>
                    {Number(selectedRule.included_tons)} tons ·{" "}
                    {selectedRule.rental_period_days} day rental
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Overage</span>
                  <span style={{ color: "var(--t-text-primary)" }}>
                    ${Number(selectedRule.overage_per_ton)}/ton after{" "}
                    {Number(selectedRule.included_tons)} tons
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Extra days</span>
                  <span style={{ color: "var(--t-text-primary)" }}>
                    ${Number(selectedRule.extra_day_rate)}/day after{" "}
                    {selectedRule.rental_period_days} days
                  </span>
                </div>
                {quoteAddress && (
                  <div className="flex justify-between">
                    <span>Delivery to</span>
                    <span style={{ color: "var(--t-text-primary)" }}>
                      {quoteAddress}
                    </span>
                  </div>
                )}
              </div>
              <p
                className="text-[11px] mt-3"
                style={{ color: "var(--t-text-tertiary)" }}
              >
                Valid for 30 days from today
              </p>
            </div>
          )}

          {/* Action buttons */}
          {selectedRule && (
            <div className="flex gap-3">
              <Link
                href={`/book?size=${quoteSize}&address=${encodeURIComponent(quoteAddress)}&name=${encodeURIComponent(quoteName)}&email=${encodeURIComponent(quoteEmail)}&phone=${encodeURIComponent(quotePhone)}`}
                className="flex-1 flex items-center justify-center gap-2 rounded-full py-3 text-[13px] font-bold transition-all duration-150"
                style={{ background: "var(--t-accent)", color: "#000" }}
              >
                <DollarSign className="h-4 w-4" /> Book Now
              </Link>
              <button
                onClick={sendQuote}
                disabled={!quoteEmail || quoteSending}
                className="flex-1 flex items-center justify-center gap-2 rounded-full py-3 text-[13px] font-bold border transition-all duration-150 disabled:opacity-50"
                style={{
                  borderColor: "var(--t-border)",
                  color: "var(--t-text-primary)",
                  background: "transparent",
                }}
              >
                <Mail className="h-4 w-4" />{" "}
                {quoteSending ? "Sending..." : "Email Quote"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Pricing SlideOver */}
      <SlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={
          editRule ? `Edit ${editRule.asset_subtype} Pricing` : "Add New Size"
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
  onSave: (data: Partial<PricingRule>) => void;
  onClose: () => void;
}) {
  const [basePrice, setBasePrice] = useState(
    rule ? String(Number(rule.base_price)) : ""
  );
  const [includedTons, setIncludedTons] = useState(
    rule ? String(Number(rule.included_tons)) : ""
  );
  const [overageRate, setOverageRate] = useState(
    rule ? String(Number(rule.overage_per_ton)) : ""
  );
  const [rentalDays, setRentalDays] = useState(
    rule ? String(rule.rental_period_days) : "14"
  );
  const [extraDayRate, setExtraDayRate] = useState(
    rule ? String(Number(rule.extra_day_rate)) : ""
  );
  const [failedTripFee, setFailedTripFee] = useState(
    rule ? String(Number(rule.failed_trip_base_fee || 150)) : "150"
  );

  const inputStyle = {
    background: "var(--t-bg-card)",
    borderColor: "var(--t-border)",
    color: "var(--t-text-primary)",
  };

  const fields = [
    {
      label: "Base Price",
      value: basePrice,
      set: setBasePrice,
      prefix: "$",
      suffix: undefined,
    },
    {
      label: "Included Tonnage",
      value: includedTons,
      set: setIncludedTons,
      prefix: undefined,
      suffix: "tons",
    },
    {
      label: "Overage Rate",
      value: overageRate,
      set: setOverageRate,
      prefix: "$",
      suffix: "/ton",
    },
    {
      label: "Rental Period",
      value: rentalDays,
      set: setRentalDays,
      prefix: undefined,
      suffix: "days",
    },
    {
      label: "Extra Day Rate",
      value: extraDayRate,
      set: setExtraDayRate,
      prefix: "$",
      suffix: "/day",
    },
    {
      label: "Failed Trip Fee",
      value: failedTripFee,
      set: setFailedTripFee,
      prefix: "$",
      suffix: undefined,
    },
  ];

  return (
    <div className="space-y-5">
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
          onClick={() =>
            onSave({
              base_price: Number(basePrice),
              included_tons: Number(includedTons),
              overage_per_ton: Number(overageRate),
              rental_period_days: Number(rentalDays),
              extra_day_rate: Number(extraDayRate),
              failed_trip_base_fee: Number(failedTripFee),
            })
          }
          className="flex-1 rounded-full py-3 text-[13px] font-bold"
          style={{ background: "var(--t-accent)", color: "#000" }}
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
