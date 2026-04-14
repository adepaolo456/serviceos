"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/utils/format-date";
import { deriveCustomerTimeline, formatRentalTitle, rentalSizeLabel, formatJobNumber, type CustomerTimelineStep } from "@/lib/job-status";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { Package, Calendar, MapPin, ChevronRight, Search, X } from "lucide-react";
import { saveListViewState, useListViewScrollRestore } from "@/lib/list-view-state";

interface Rental {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  scheduled_date: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_days: number;
  total_price: number;
  asset_subtype?: string | null;
  service_address: { formatted?: string; street?: string } | null;
  asset: { identifier?: string; subtype?: string } | null;
  completed_at: string | null;
  created_at: string;
}

const tabs = ["Active", "Upcoming", "Completed", "All"] as const;
type TabKey = typeof tabs[number];
const TAB_REGISTRY_KEY: Record<TabKey, string> = {
  Active: "portal_rentals_tab_active",
  Upcoming: "portal_rentals_tab_upcoming",
  Completed: "portal_rentals_tab_completed",
  All: "portal_rentals_tab_all",
};

function HorizontalTimeline({ steps }: { steps: CustomerTimelineStep[] }) {
  return (
    <div className="w-full overflow-x-auto py-3">
      <div className="flex items-center min-w-[400px]">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 shrink-0 ${
                step.state === "done"
                  ? "border-[var(--t-accent)] bg-[var(--t-accent)]"
                  : step.state === "current"
                  ? "border-blue-500 bg-blue-500"
                  : "border-[var(--t-border)] bg-transparent"
              }`}>
                {step.state === "done" && (
                  <svg className="h-3 w-3 text-[var(--t-accent-on-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                )}
                {step.state === "current" && (
                  <div className="h-2 w-2 rounded-full bg-white" />
                )}
              </div>
              <span className={`mt-1.5 text-[10px] font-medium text-center leading-tight max-w-[72px] ${
                step.state === "done"
                  ? "text-[var(--t-accent)]"
                  : step.state === "current"
                  ? "text-blue-400"
                  : "text-[var(--t-text-muted)]"
              }`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-18px] ${
                step.state === "done" ? "bg-[var(--t-accent)]" : "bg-[var(--t-border)]"
              }`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-500",
  confirmed: "text-blue-400",
  dispatched: "text-indigo-400",
  en_route: "text-purple-400",
  in_progress: "text-[var(--t-accent)]",
  completed: "text-[var(--t-text-muted)]",
  cancelled: "text-[var(--t-error)]",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  en_route: "En Route",
  in_progress: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Phase B17 — this page is list-only. The rental detail view now lives
// at the dynamic route /portal/rentals/[id] so list and detail are
// distinct pathnames, eliminating the Next.js same-pathname search-param
// reactivity bug that trapped users inside the detail view.
// List-view-state key — namespaced to the portal so it can never
// collide with the tenant-side `/customers`, `/invoices`, `/jobs`
// keys that use the same shared util. sessionStorage is per-tab
// per-origin so tenant and portal already live in separate scopes
// in most setups, but the distinct page key is belt + suspenders.
const PORTAL_RENTALS_LIST_KEY = "/portal/rentals";

interface PortalRentalsListExtra {
  tab: TabKey;
  query: string;
}

export default function PortalRentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("Active");
  const [query, setQuery] = useState("");

  // Ref-backed current tab + query so the Link onClick handlers
  // always snapshot the LATEST values without being re-created on
  // every keystroke. Saves the filter context alongside scroll so
  // returning from a rental detail lands the user at the same
  // Active/Upcoming/Completed/All tab and the same search query.
  const tabRef = useRef<TabKey>(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const queryRef = useRef<string>(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  const snapshotListState = useCallback(() => {
    saveListViewState<PortalRentalsListExtra>(PORTAL_RENTALS_LIST_KEY, {
      tab: tabRef.current,
      query: queryRef.current,
    });
  }, []);

  useEffect(() => {
    portalApi.get<Rental[]>("/portal/rentals").then(setRentals).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Restore tab + search + scroll position when returning from a
  // rental detail. Gated on `!loading` so the fetched rentals are
  // in place before we try to scroll into them. `onExtra` fires
  // synchronously inside the effect so tab/query state is applied
  // before the deferred `requestAnimationFrame` scroll lands.
  useListViewScrollRestore<PortalRentalsListExtra>(
    PORTAL_RENTALS_LIST_KEY,
    !loading,
    useCallback((extra: PortalRentalsListExtra) => {
      if (extra?.tab) setTab(extra.tab);
      if (typeof extra?.query === "string") setQuery(extra.query);
    }, []),
  );

  const tabFiltered = useMemo(() => rentals.filter(r => {
    if (tab === "All") return true;
    if (tab === "Active") return !["completed", "cancelled", "pending"].includes(r.status) && r.job_type === "delivery";
    if (tab === "Upcoming") return r.status === "pending" && r.job_type === "delivery";
    if (tab === "Completed") return r.status === "completed" || r.status === "cancelled";
    return true;
  }), [rentals, tab]);

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmedQuery) return tabFiltered;
    return tabFiltered.filter(r => {
      const haystack = [
        r.job_number,
        r.status,
        STATUS_LABELS[r.status],
        r.asset_subtype,
        rentalSizeLabel(r),
        r.service_address?.formatted,
        r.service_address?.street,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedQuery);
    });
  }, [tabFiltered, trimmedQuery]);

  return (
    <div className="space-y-5">
      {/* Title row + search — Phase B9: tighter header block and an inline
          client-side search so customers can find a rental instantly. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-[-1px] leading-tight text-[var(--t-frame-text)]">
          {FEATURE_REGISTRY.portal_rentals_title?.label ?? "My Rentals"}
        </h1>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--t-text-muted)] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={FEATURE_REGISTRY.portal_rentals_search_placeholder?.label ?? "Search by address, size, or job number…"}
            className="w-full rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] pl-9 pr-9 py-2 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
            aria-label={FEATURE_REGISTRY.portal_rentals_search_placeholder?.label ?? "Search rentals"}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Segmented tab control */}
      <div className="flex justify-center sm:justify-start">
        <div
          role="tablist"
          aria-label="Rental filters"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] p-1 shadow-sm max-w-full overflow-x-auto"
        >
          {tabs.map(t => {
            const isActive = tab === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(t)}
                className={`relative rounded-full px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)]"
                    : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                }`}
              >
                {FEATURE_REGISTRY[TAB_REGISTRY_KEY[t]]?.label ?? t}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-28 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
          <Package className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
          {trimmedQuery ? (
            <>
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">
                {FEATURE_REGISTRY.portal_rentals_no_results?.label ?? "No rentals match your search."}
              </p>
              <p className="text-xs text-[var(--t-text-muted)] mt-1">
                {FEATURE_REGISTRY.portal_rentals_no_results_hint?.label ?? "Try a different address, size, or job number."}
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-[var(--t-text-muted)]">
              {FEATURE_REGISTRY.portal_rentals_empty_tab?.label ?? "No rentals in this view yet."}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const steps = r.job_type === "delivery" ? deriveCustomerTimeline(r, rentals) : [];
            return (
              <Link
                key={r.id}
                href={`/portal/rentals/${r.id}`}
                onClick={snapshotListState}
                className="block w-full text-left rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3.5 sm:p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors min-w-0"
              >
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="mb-1 flex items-start gap-2 min-w-0">
                      <p className="text-sm font-semibold text-[var(--t-text-primary)] truncate min-w-0 flex-1">{formatRentalTitle(r)}</p>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 whitespace-nowrap ${STATUS_COLORS[r.status] || ""}`}>{STATUS_LABELS[r.status] || r.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--t-text-muted)] min-w-0">
                      <span className="font-mono shrink-0">{formatJobNumber(r.job_number)}</span>
                      {r.service_address && (
                        <span className="flex items-center gap-1 min-w-0 basis-full sm:basis-auto sm:flex-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate min-w-0 flex-1">{r.service_address.formatted || r.service_address.street}</span>
                        </span>
                      )}
                      {r.rental_start_date && <span className="flex items-center gap-1 shrink-0"><Calendar className="h-3 w-3" />{formatDateOnly(r.rental_start_date)}</span>}
                      {r.total_price ? <span className="font-semibold text-[var(--t-text-primary)] shrink-0">{formatCurrency(r.total_price)}</span> : null}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--t-text-muted)] shrink-0" />
                </div>
                {steps.length > 0 && (
                  <div className="mt-2 border-t border-[var(--t-border)]/50 pt-1">
                    <HorizontalTimeline steps={steps} />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
