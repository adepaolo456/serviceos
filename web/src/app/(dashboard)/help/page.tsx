"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, ExternalLink, X } from "lucide-react";
import {
  getFeature,
  getGuideEligibleFeatures,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type FeatureDescription,
  type FeatureCategory,
} from "@/lib/feature-registry";

/* ── Routes that have real pages (verified) ── */
const NAVIGABLE_ROUTES = new Set([
  "/", "/jobs", "/dispatch", "/customers", "/assets", "/invoices",
  "/billing-issues", "/pricing-qa", "/pricing", "/team", "/vehicles",
  "/analytics", "/notifications", "/marketplace", "/settings",
  "/dump-locations", "/book", "/help",
]);

function isNavigableRoute(route: string): boolean {
  return NAVIGABLE_ROUTES.has(route);
}

const POPULAR_IDS = ["new_booking", "dashboard", "jobs", "dispatch_board", "pricing_issues"];

/* ── Search matching ── */
function matchesSearch(f: FeatureDescription, query: string): boolean {
  const q = query.toLowerCase();
  if (f.label.toLowerCase().includes(q)) return true;
  if (f.shortDescription.toLowerCase().includes(q)) return true;
  if (f.guideDescription.toLowerCase().includes(q)) return true;
  if (f.keywords.some(k => k.toLowerCase().includes(q))) return true;
  return false;
}

/* ── Page ── */
export default function HelpCenterPage() {
  const [search, setSearch] = useState("");

  const allFeatures = useMemo(() => getGuideEligibleFeatures(), []);

  const filtered = useMemo(() => {
    if (search.length < 2) return null; // show default view
    return allFeatures.filter(f => matchesSearch(f, search));
  }, [allFeatures, search]);

  const grouped = useMemo(() => {
    const map = new Map<FeatureCategory, FeatureDescription[]>();
    for (const f of allFeatures) {
      const list = map.get(f.category) || [];
      list.push(f);
      map.set(f.category, list);
    }
    return map;
  }, [allFeatures]);

  const popularTopics = useMemo(() =>
    POPULAR_IDS.map(id => getFeature(id)).filter((f): f is FeatureDescription => !!f && f.isGuideEligible && f.isUserFacing),
  []);

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
          Help Center
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--t-frame-text-muted)" }}>
          Find answers and learn how ServiceOS works.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-xl mx-auto mb-10">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "var(--t-text-muted)" }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search help topics..."
          className="w-full rounded-[20px] border py-3.5 pl-12 pr-12 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full" style={{ color: "var(--t-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search results */}
      {filtered !== null ? (
        <div>
          <p className="text-sm mb-4" style={{ color: "var(--t-text-muted)" }}>
            {filtered.length > 0
              ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${search}"`
              : `No topics found for "${search}". Try a different search term.`}
          </p>
          {filtered.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(f => <TopicCard key={f.id} feature={f} />)}
            </div>
          )}
        </div>
      ) : (
        /* Default view */
        <div>
          {/* Popular Topics */}
          {popularTopics.length > 0 && (
            <div className="mb-10">
              <h2 className="text-[15px] font-bold tracking-[-0.3px] mb-3" style={{ color: "var(--t-frame-text)" }}>Popular Topics</h2>
              <div className="flex flex-wrap gap-2">
                {popularTopics.map(f => (
                  <Link
                    key={f.id}
                    href={isNavigableRoute(f.routeOrSurface) ? f.routeOrSurface : "#"}
                    className="rounded-full border px-4 py-2 text-sm font-medium transition-all"
                    style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-accent)"; e.currentTarget.style.color = "var(--t-accent)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Category sections */}
          {CATEGORY_ORDER.map(cat => {
            const features = grouped.get(cat);
            if (!features || features.length === 0) return null;
            return (
              <div key={cat} className="mb-10">
                <h2 className="text-[15px] font-bold tracking-[-0.3px] mb-4" style={{ color: "var(--t-frame-text)" }}>
                  {CATEGORY_LABELS[cat]}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {features.sort((a, b) => a.label.localeCompare(b.label)).map(f => (
                    <TopicCard key={f.id} feature={f} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Topic Card ── */
function TopicCard({ feature }: { feature: FeatureDescription }) {
  const hasRoute = isNavigableRoute(feature.routeOrSurface);
  return (
    <div
      className="rounded-[14px] border p-4 transition-all"
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-border-strong)"; e.currentTarget.style.boxShadow = "0 2px 8px var(--t-shadow)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.boxShadow = ""; }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{feature.label}</h3>
        <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}>
          {CATEGORY_LABELS[feature.category]}
        </span>
      </div>
      <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--t-text-secondary)" }}>
        {feature.guideDescription}
      </p>
      {hasRoute && (
        <Link href={feature.routeOrSurface} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--t-accent)" }}>
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
