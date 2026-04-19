"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { getFeatureLabel } from "@/lib/feature-registry";
import type { InitialSchedule } from "@/components/booking-wizard";
import { useQuickQuote } from "@/components/quick-quote-provider";

interface CustomerResult {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  company_name?: string;
  email: string;
  phone: string;
  billing_address?: { street: string; city: string; state: string; zip: string };
}

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSearching(false);
    }
  }, [open]);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get<CustomerResult[]>(
          `/customers/search?q=${encodeURIComponent(q.trim())}&limit=8`,
        );
        setResults(Array.isArray(res) ? res : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, []);

  const selectCustomer = (c: CustomerResult) => {
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
              onChange={(e) => handleSearch(e.target.value)}
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
            <Plus className="h-4 w-4" /> Continue as New Customer
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
