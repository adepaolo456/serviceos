"use client";

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, ExternalLink, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  getFeature,
  getVisibleGuideFeatures,
  getRelatedFeatures,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type FeatureDescription,
  type FeatureCategory,
} from "@/lib/feature-registry";
import {
  trackHelpCenterViewed,
  trackHelpTopicViewed,
  trackHelpSearchUsed,
  trackHelpRelatedTopicClicked,
  trackHelpTopicNotFound,
  type HelpAnalyticsSource,
} from "@/lib/help-analytics";

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

function matchesSearch(f: FeatureDescription, query: string): boolean {
  const q = query.toLowerCase();
  return f.label.toLowerCase().includes(q)
    || f.shortDescription.toLowerCase().includes(q)
    || f.guideDescription.toLowerCase().includes(q)
    || f.keywords.some(k => k.toLowerCase().includes(q));
}

export default function HelpCenterPageWrapper() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>Loading Help Center...</div>}>
      <HelpCenterPage />
    </Suspense>
  );
}

function HelpCenterPage() {
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedRef = useRef<HTMLDivElement>(null);

  const selectedId = searchParams.get("feature") || null;

  const allFeatures = useMemo(() => getVisibleGuideFeatures(), []);

  const filtered = useMemo(() => {
    if (search.length < 2) return null;
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

  const pathname = usePathname();
  const selectedFeature = selectedId ? getFeature(selectedId) : null;
  const relatedTopics = useMemo(() =>
    selectedId ? getRelatedFeatures(selectedId) : [],
  [selectedId]);

  // Track source context for topic selection
  const selectionSourceRef = useRef<HelpAnalyticsSource>("unknown");
  const lastTrackedFeatureRef = useRef<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Page view — fire once on mount
  useEffect(() => {
    trackHelpCenterViewed({
      pagePath: pathname,
      source: selectedId ? "unknown" : "direct",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Topic viewed — fires when selectedId changes
  useEffect(() => {
    if (!selectedId) { lastTrackedFeatureRef.current = null; return; }
    if (lastTrackedFeatureRef.current === selectedId) return;
    lastTrackedFeatureRef.current = selectedId;

    if (!getFeature(selectedId)) {
      trackHelpTopicNotFound({ featureId: selectedId, pagePath: pathname });
      return;
    }
    trackHelpTopicViewed({
      featureId: selectedId, pagePath: pathname,
      source: selectionSourceRef.current,
    });
    selectionSourceRef.current = "unknown"; // reset after use
  }, [selectedId, pathname]);

  // Search tracking — debounced 800ms
  useEffect(() => {
    if (search.length < 2) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      trackHelpSearchUsed({ pagePath: pathname, searchQuery: search });
    }, 800);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search, pathname]);

  // Scroll selected into view on deep-link
  useEffect(() => {
    if (selectedId && selectedRef.current) {
      setTimeout(() => selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    }
  }, [selectedId]);

  const selectFeature = (id: string, source: HelpAnalyticsSource = "direct") => {
    selectionSourceRef.current = source;
    router.replace(`/help?feature=${id}`, { scroll: false });
  };

  const selectRelatedTopic = (fromId: string, toId: string) => {
    trackHelpRelatedTopicClicked({ featureId: fromId, relatedFeatureId: toId, pagePath: pathname });
    selectionSourceRef.current = "related_topics";
    router.replace(`/help?feature=${toId}`, { scroll: false });
  };

  const clearSelection = () => {
    router.replace("/help", { scroll: false });
  };

  // If search hides the selected feature, don't show related
  const selectedVisibleInSearch = !filtered || (selectedFeature && filtered.some(f => f.id === selectedId));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Help Center</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--t-frame-text-muted)" }}>Find answers and learn how ServiceOS works.</p>
      </div>

      {/* Search */}
      <div className="relative max-w-xl mx-auto mb-10">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: "var(--t-text-muted)" }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search help topics..."
          className="w-full rounded-[20px] border py-3.5 pl-12 pr-12 text-sm outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
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
              {filtered.map(f => (
                <div key={f.id} ref={f.id === selectedId ? selectedRef : undefined}>
                  <TopicCard feature={f} isSelected={f.id === selectedId} onSelect={(id) => selectFeature(id, "search")} />
                  {f.id === selectedId && selectedVisibleInSearch && relatedTopics.length > 0 && (
                    <RelatedSection topics={relatedTopics} selectedId={selectedId} onSelect={selectRelatedTopic} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Popular Topics */}
          {popularTopics.length > 0 && (
            <div className="mb-10">
              <h2 className="text-[15px] font-bold tracking-[-0.3px] mb-3" style={{ color: "var(--t-frame-text)" }}>Popular Topics</h2>
              <div className="flex flex-wrap gap-2">
                {popularTopics.map(f => (
                  <button key={f.id} onClick={() => selectFeature(f.id)}
                    className="rounded-full border px-4 py-2 text-sm font-medium transition-all"
                    style={{ background: selectedId === f.id ? "var(--t-accent-soft)" : "var(--t-bg-card)", borderColor: selectedId === f.id ? "var(--t-accent)" : "var(--t-border)", color: selectedId === f.id ? "var(--t-accent)" : "var(--t-text-primary)" }}>
                    {f.label}
                  </button>
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
                    <div key={f.id} ref={f.id === selectedId ? selectedRef : undefined}>
                      <TopicCard feature={f} isSelected={f.id === selectedId} onSelect={selectFeature} />
                      {f.id === selectedId && relatedTopics.length > 0 && (
                        <RelatedSection topics={relatedTopics} selectedId={selectedId} onSelect={selectRelatedTopic} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Clear selection hint */}
      {selectedId && (
        <div className="fixed bottom-6 right-6 z-50">
          <button onClick={clearSelection}
            className="rounded-full border px-4 py-2 text-xs font-medium shadow-lg transition-all"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
            <X className="h-3 w-3 inline mr-1" /> Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Topic Card ── */
function TopicCard({ feature, isSelected, onSelect }: { feature: FeatureDescription; isSelected?: boolean; onSelect?: (id: string) => void }) {
  const hasRoute = isNavigableRoute(feature.routeOrSurface);
  return (
    <div
      onClick={() => onSelect?.(feature.id)}
      className="rounded-[14px] border p-4 transition-all cursor-pointer"
      style={{
        background: isSelected ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
        borderColor: isSelected ? "var(--t-accent)" : "var(--t-border)",
        boxShadow: isSelected ? "0 0 0 1px var(--t-accent)" : "",
      }}
      onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = "var(--t-border-strong)"; e.currentTarget.style.boxShadow = "0 2px 8px var(--t-shadow)"; } }}
      onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.boxShadow = ""; } }}
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
        <Link href={feature.routeOrSurface} onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--t-accent)" }}>
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

/* ── Related Topics Section ── */
function RelatedSection({ topics, selectedId, onSelect }: { topics: FeatureDescription[]; selectedId: string; onSelect: (fromId: string, toId: string) => void }) {
  return (
    <div className="mt-3 mb-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Related Topics</p>
      <div className="flex gap-3 overflow-x-auto">
        {topics.map(f => (
          <button key={f.id} onClick={() => onSelect(selectedId, f.id)}
            className="shrink-0 rounded-[12px] border p-3 text-left transition-all"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border-subtle)", minWidth: 180, maxWidth: 220 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-border-strong)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border-subtle)"; }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>{f.label}</p>
            <p className="text-[11px] leading-snug line-clamp-2" style={{ color: "var(--t-text-muted)" }}>{f.shortDescription}</p>
            {isNavigableRoute(f.routeOrSurface) && (
              <Link href={f.routeOrSurface} onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[10px] font-medium mt-1.5" style={{ color: "var(--t-accent)" }}>
                Open <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
