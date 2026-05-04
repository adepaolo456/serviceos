"use client";

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, ExternalLink, X, ChevronRight } from "lucide-react";
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
import SlideOver from "@/components/slide-over";

const NAVIGABLE_ROUTES = new Set([
  "/", "/jobs", "/dispatch", "/customers", "/assets", "/invoices",
  "/billing-issues", "/pricing-qa", "/pricing", "/team", "/vehicles",
  "/analytics", "/notifications", "/marketplace", "/settings",
  "/dump-locations", "/book", "/help", "/portal-activity", "/quotes",
  "/credit-queue", "/credit-audit", "/credit-analytics",
]);

function isNavigableRoute(route: string): boolean {
  const base = route.split("?")[0];
  return NAVIGABLE_ROUTES.has(base);
}

const POPULAR_IDS = ["quick_quote", "dashboard", "jobs", "dispatch_board", "pricing_issues"];

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
        <p className="mt-1 text-[13px]" style={{ color: "var(--t-frame-text-muted)" }}>Find answers and learn how RentThisApp works.</p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(f => (
                <TopicCard key={f.id} feature={f} onSelect={(id) => selectFeature(id, "search")} />
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
              <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
                {popularTopics.map(f => (
                  <button key={f.id} onClick={() => selectFeature(f.id)}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 18, border: "none", cursor: "pointer", transition: "all 0.15s ease", backgroundColor: selectedId === f.id ? "var(--t-accent)" : "transparent", color: selectedId === f.id ? "#fff" : "var(--t-text-muted)" }}>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {features.sort((a, b) => a.label.localeCompare(b.label)).map(f => (
                    <TopicCard key={f.id} feature={f} onSelect={selectFeature} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Topic detail SlideOver */}
      <SlideOver
        open={!!selectedFeature}
        onClose={clearSelection}
        title={selectedFeature?.label || ""}
        wide
        headerActions={
          selectedFeature && isNavigableRoute(selectedFeature.routeOrSurface) ? (
            <Link href={selectedFeature.routeOrSurface} onClick={clearSelection}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium no-underline"
              style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}>
              Open {selectedFeature.label} <ExternalLink className="h-3 w-3" />
            </Link>
          ) : undefined
        }
      >
        {selectedFeature && (
          <div>
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full mb-5"
              style={{ backgroundColor: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}>
              {CATEGORY_LABELS[selectedFeature.category]}
            </span>
            <p className="text-xs mb-6" style={{ color: "var(--t-text-muted)" }}>{selectedFeature.shortDescription}</p>
            <div className="text-sm leading-relaxed" style={{ color: "var(--t-text-secondary)", maxWidth: 560 }}>
              {selectedFeature.guideDescription.split(". ").reduce<string[][]>((acc, sentence, i, arr) => {
                // Group into paragraphs of ~2-3 sentences
                const last = acc[acc.length - 1];
                if (last && last.length < 3) { last.push(sentence + (i < arr.length - 1 ? "." : "")); }
                else { acc.push([sentence + (i < arr.length - 1 ? "." : "")]); }
                return acc;
              }, []).map((para, i) => (
                <p key={i} className="mb-4">{para.join(" ")}</p>
              ))}
            </div>

            {/* Related Topics */}
            {relatedTopics.length > 0 && (
              <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--t-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--t-text-muted)" }}>Related Topics</p>
                <div className="flex flex-col gap-2">
                  {relatedTopics.map(f => (
                    <button key={f.id} onClick={() => selectRelatedTopic(selectedFeature.id, f.id)}
                      className="flex items-center gap-3 rounded-[12px] border p-3 text-left transition-all"
                      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-accent)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border)"; }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold" style={{ color: "var(--t-text-primary)" }}>{f.label}</p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--t-text-muted)" }}>{f.shortDescription}</p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t-text-muted)" }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}

/* ── Topic Card (Uniform, Truncated) ── */
function TopicCard({ feature, onSelect }: { feature: FeatureDescription; onSelect?: (id: string) => void }) {
  const hasRoute = isNavigableRoute(feature.routeOrSurface);
  return (
    <div
      onClick={() => onSelect?.(feature.id)}
      className="rounded-[14px] border p-4 transition-all cursor-pointer flex flex-col"
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", minHeight: 120 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-accent)"; e.currentTarget.style.boxShadow = "0 2px 8px var(--t-shadow)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{feature.label}</h3>
        <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}>
          {CATEGORY_LABELS[feature.category]}
        </span>
      </div>
      <p className="text-xs leading-relaxed line-clamp-2 flex-1" style={{ color: "var(--t-text-secondary)" }}>
        {feature.shortDescription}
      </p>
      <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: "1px solid var(--t-border-subtle, var(--t-border))" }}>
        {hasRoute ? (
          <Link href={feature.routeOrSurface} onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] font-medium no-underline" style={{ color: "var(--t-accent)" }}>
            Open page <ExternalLink className="h-3 w-3" />
          </Link>
        ) : <span />}
        <span className="text-[11px] font-medium flex items-center gap-0.5" style={{ color: "var(--t-text-muted)" }}>
          Read more <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
