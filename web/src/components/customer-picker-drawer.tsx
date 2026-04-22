"use client";

import { useEffect } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import SlideOver from "@/components/slide-over";
import { getFeatureLabel } from "@/lib/feature-registry";
import type { InitialSchedule } from "@/components/booking-wizard";
import { useQuickQuote } from "@/components/quick-quote-provider";
import {
  useCustomerAutocomplete,
  type CustomerSearchResult,
} from "@/lib/use-customer-autocomplete";

interface CustomerPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (opts: { customerId?: string; initialSchedule?: InitialSchedule }) => void;
  initialSchedule?: InitialSchedule;
}

/**
 * Customer-first entry point for Quick Quote → Book Now.
 * Lets the user pick an existing customer or continue as new,
 * then hands off to the booking wizard with both customer + schedule context.
 */
export default function CustomerPickerDrawer({
  open,
  onClose,
  onSelect,
  initialSchedule,
}: CustomerPickerDrawerProps) {
  const { reopenQuoteWithSnapshot } = useQuickQuote();
  const {
    query,
    setQuery,
    results,
    isLoading: searching,
    reset,
    clearResults,
  } = useCustomerAutocomplete({ maxResults: 8 });

  // Reset on drawer open (conditional — must not fight user typing).
  // `reset` is memoized with empty deps in the hook, so including it in
  // the dep array causes no extra re-runs while satisfying exhaustive-deps.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const selectCustomer = (c: CustomerSearchResult) => {
    onClose();
    onSelect({ customerId: c.id, initialSchedule });
  };

  const continueAsNew = () => {
    onClose();
    onSelect({ initialSchedule });
  };

  const addrLine = initialSchedule?.siteAddress
    ? [initialSchedule.siteAddress.street, initialSchedule.siteAddress.city, initialSchedule.siteAddress.state, initialSchedule.siteAddress.zip].filter(Boolean).join(", ")
    : null;

  return (
    <SlideOver open={open} onClose={onClose} title={getFeatureLabel("quick_quote_book_now")} side="left">
      <div className="space-y-4">
        {/* Quote context summary */}
        {(initialSchedule?.dumpsterSize || addrLine) && (
          <div
            className="rounded-[14px] border-l-4 p-4"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-accent)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>
              Quote Details
            </p>
            {initialSchedule?.dumpsterSize && (
              <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>
                {initialSchedule.dumpsterSize.replace("yd", " Yard")} Dumpster
              </p>
            )}
            {addrLine && (
              <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                {addrLine}
              </p>
            )}
            <button
              type="button"
              onClick={reopenQuoteWithSnapshot}
              className="mt-2 text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: "var(--t-accent)" }}
            >
              ← Edit Quote
            </button>
          </div>
        )}

        {/* Customer search */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--t-text-muted)" }}>
            Select Customer
          </p>
          <div className="relative">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4"
              style={{ color: "var(--t-text-muted)" }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                // Preserve pre-migration behavior: when the user
                // backspaces below the hook's min query length, clear
                // stale results immediately so the "last search"
                // results don't remain visible while the input is too
                // short to search. clearResults preserves `query` so
                // the input keeps showing what the user typed.
                if (v.trim().length < 2) clearResults();
              }}
              placeholder="Search by name, email, or phone..."
              className="w-full rounded-[14px] border bg-[var(--t-bg-card)] pl-10 pr-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
              autoFocus
            />
          </div>
        </div>

        {/* Search results */}
        {searching && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--t-text-muted)" }} />
            <span className="text-sm" style={{ color: "var(--t-text-muted)" }}>Searching...</span>
          </div>
        )}

        {!searching && results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCustomer(c)}
                className="w-full rounded-[14px] border px-4 py-3 text-left transition-colors hover:border-[var(--t-accent)]"
                style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
              >
                <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                  {c.first_name} {c.last_name}
                </span>
                {c.company_name && (
                  <span className="ml-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    {c.company_name}
                  </span>
                )}
                <span className="block text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                </span>
                {c.billing_address && (
                  <span className="block text-xs" style={{ color: "var(--t-text-muted)" }}>
                    {[c.billing_address.street, c.billing_address.city, c.billing_address.state].filter(Boolean).join(", ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm py-2" style={{ color: "var(--t-text-muted)" }}>
            No customers found for &ldquo;{query}&rdquo;
          </p>
        )}

        {/* Continue as new customer */}
        <div style={{ borderTop: "1px solid var(--t-border)", paddingTop: 16 }}>
          <button
            type="button"
            onClick={continueAsNew}
            className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold border transition-colors hover:bg-[var(--t-bg-card-hover)]"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          >
            <Plus className="h-4 w-4" /> {getFeatureLabel("customer_picker_continue_as_new")}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
