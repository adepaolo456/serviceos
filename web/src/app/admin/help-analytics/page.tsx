"use client";

import { useState, useEffect, useCallback } from "react";
import { getFeature, CATEGORY_LABELS, type FeatureDescription } from "@/lib/feature-registry";
import { api } from "@/lib/api";

/* ── Types ── */
interface Summary {
  days: number;
  totals: {
    topicViews: number; tooltipClicks: number; searches: number;
    relatedClicks: number; invalidDeepLinks: number;
    distinctFeaturesViewed: number; distinctSearchQueries: number;
  };
  topTopics: Array<{ featureId: string; views: number }>;
  topTooltips: Array<{ featureId: string; clicks: number }>;
  topSearches: Array<{ query: string; count: number }>;
  topRelatedPairs: Array<{ fromFeatureId: string; toFeatureId: string; count: number }>;
  demandScores: Array<{ featureId: string; views: number; tooltips: number; related: number; score: number }>;
  orphanedFeatureIds: string[];
}

/* ── Registry resolver — all labels from registry ── */
function resolveLabel(featureId: string): string | null {
  return getFeature(featureId)?.label || null;
}
function resolveCategory(featureId: string): string | null {
  const f = getFeature(featureId);
  return f ? CATEGORY_LABELS[f.category] : null;
}
function isRegistered(featureId: string): boolean {
  return !!getFeature(featureId);
}

const DAYS_OPTIONS = [7, 30, 90];

export default function HelpAnalyticsPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Summary>(`/help-analytics/summary?days=${days}`);
      setData(result);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const t = data?.totals;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--t-frame-text)" }}>Help Analytics</h1>
        <p className="text-sm mt-1" style={{ color: "var(--t-frame-text-muted)" }}>
          Internal usage analytics for Help Center and tooltip help discovery.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6">
        {DAYS_OPTIONS.map(d => (
          <button key={d} onClick={() => setDays(d)}
            className="rounded-full px-3 py-1.5 text-xs font-medium border transition-all"
            style={{
              background: days === d ? "var(--t-accent-soft)" : "var(--t-bg-card)",
              borderColor: days === d ? "var(--t-accent)" : "var(--t-border)",
              color: days === d ? "var(--t-accent)" : "var(--t-text-muted)",
            }}>
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-[14px] skeleton" />
          ))}
        </div>
      ) : !data || !t ? (
        <div className="py-20 text-center">
          <p className="text-lg font-semibold" style={{ color: "var(--t-frame-text)" }}>No analytics data yet</p>
          <p className="text-sm mt-1" style={{ color: "var(--t-frame-text-muted)" }}>
            Help analytics will appear once users interact with Help Center or tooltips.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Topic Views" value={t.topicViews} />
            <StatCard label="Tooltip Clicks" value={t.tooltipClicks} />
            <StatCard label="Searches" value={t.searches} />
            <StatCard label="Related Clicks" value={t.relatedClicks} />
            <StatCard label="Invalid Links" value={t.invalidDeepLinks} color={t.invalidDeepLinks > 0 ? "var(--t-error)" : undefined} />
            <StatCard label="Features Viewed" value={t.distinctFeaturesViewed} />
          </div>

          {/* Top Help Topics */}
          <Section title="Top Help Topics">
            {data.topTopics.filter(r => isRegistered(r.featureId)).length === 0 ? (
              <EmptyRow />
            ) : (
              <table className="w-full"><thead><tr className="table-header">
                <Th>Feature</Th><Th>Category</Th><Th align="right">Views</Th>
              </tr></thead><tbody>
                {data.topTopics.filter(r => isRegistered(r.featureId)).map(r => (
                  <tr key={r.featureId} className="table-row">
                    <Td bold>{resolveLabel(r.featureId)}</Td>
                    <Td muted>{resolveCategory(r.featureId)}</Td>
                    <Td align="right" bold>{r.views}</Td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Section>

          {/* Tooltip Click Leaders */}
          <Section title="Tooltip Click Leaders">
            {data.topTooltips.filter(r => isRegistered(r.featureId)).length === 0 ? (
              <EmptyRow />
            ) : (
              <table className="w-full"><thead><tr className="table-header">
                <Th>Feature</Th><Th>Category</Th><Th align="right">Clicks</Th>
              </tr></thead><tbody>
                {data.topTooltips.filter(r => isRegistered(r.featureId)).map(r => (
                  <tr key={r.featureId} className="table-row">
                    <Td bold>{resolveLabel(r.featureId)}</Td>
                    <Td muted>{resolveCategory(r.featureId)}</Td>
                    <Td align="right" bold>{r.clicks}</Td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Section>

          {/* Top Searches */}
          <Section title="Top Search Queries">
            {data.topSearches.length === 0 ? <EmptyRow /> : (
              <table className="w-full"><thead><tr className="table-header">
                <Th>Query</Th><Th align="right">Count</Th>
              </tr></thead><tbody>
                {data.topSearches.map(r => (
                  <tr key={r.query} className="table-row">
                    <Td>"{r.query}"</Td>
                    <Td align="right" bold>{r.count}</Td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Section>

          {/* Help Demand Scores */}
          <Section title="Highest Help Demand">
            {data.demandScores.filter(r => isRegistered(r.featureId)).length === 0 ? (
              <EmptyRow />
            ) : (
              <table className="w-full"><thead><tr className="table-header">
                <Th>Feature</Th><Th>Category</Th><Th align="right">Views</Th><Th align="right">Tooltips</Th><Th align="right">Related</Th><Th align="right">Score</Th>
              </tr></thead><tbody>
                {data.demandScores.filter(r => isRegistered(r.featureId)).map(r => (
                  <tr key={r.featureId} className="table-row">
                    <Td bold>{resolveLabel(r.featureId)}</Td>
                    <Td muted>{resolveCategory(r.featureId)}</Td>
                    <Td align="right">{r.views}</Td>
                    <Td align="right">{r.tooltips}</Td>
                    <Td align="right">{r.related}</Td>
                    <Td align="right" bold>{r.score}</Td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Section>

          {/* Related Topic Paths */}
          <Section title="Related Topic Paths">
            {data.topRelatedPairs.filter(r => isRegistered(r.fromFeatureId) && isRegistered(r.toFeatureId)).length === 0 ? (
              <EmptyRow />
            ) : (
              <table className="w-full"><thead><tr className="table-header">
                <Th>From</Th><Th>To</Th><Th align="right">Count</Th>
              </tr></thead><tbody>
                {data.topRelatedPairs.filter(r => isRegistered(r.fromFeatureId) && isRegistered(r.toFeatureId)).map((r, i) => (
                  <tr key={i} className="table-row">
                    <Td>{resolveLabel(r.fromFeatureId)}</Td>
                    <Td>{resolveLabel(r.toFeatureId)}</Td>
                    <Td align="right" bold>{r.count}</Td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Section>

          {/* Orphaned / Invalid */}
          {(data.orphanedFeatureIds.length > 0 || t.invalidDeepLinks > 0) && (
            <Section title="Invalid / Orphaned Events" diagnostic>
              <p className="text-xs mb-3" style={{ color: "var(--t-text-muted)" }}>
                These feature IDs were referenced in analytics events but do not exist in the feature registry.
              </p>
              {data.orphanedFeatureIds.length > 0 ? (
                <div className="space-y-1">
                  {data.orphanedFeatureIds.map(id => (
                    <div key={id} className="text-xs font-mono px-3 py-1.5 rounded-lg" style={{ background: "var(--t-bg-inset)", color: "var(--t-error)" }}>
                      {id}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--t-text-tertiary)" }}>No orphaned feature IDs.</p>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Reusable sub-components ── */

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-[14px] border p-3" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
      <p className="text-lg font-bold tabular-nums" style={{ color: color || "var(--t-text-primary)" }}>{value}</p>
      <p className="text-[11px] font-medium" style={{ color: "var(--t-text-muted)" }}>{label}</p>
    </div>
  );
}

function Section({ title, children, diagnostic }: { title: string; children: React.ReactNode; diagnostic?: boolean }) {
  return (
    <div className="rounded-[14px] border p-5" style={{
      background: "var(--t-bg-card)",
      borderColor: diagnostic ? "var(--t-error)" : "var(--t-border)",
      borderLeftWidth: diagnostic ? 3 : 1,
      borderLeftColor: diagnostic ? "var(--t-error)" : undefined,
    }}>
      <h2 className="text-[15px] font-bold tracking-[-0.3px] mb-4" style={{ color: diagnostic ? "var(--t-error)" : "var(--t-frame-text)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: string }) {
  return <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] ${align === "right" ? "text-right" : "text-left"}`} style={{ color: "var(--t-text-muted)" }}>{children}</th>;
}

function Td({ children, bold, muted, align }: { children: React.ReactNode; bold?: boolean; muted?: boolean; align?: string }) {
  return <td className={`px-3 py-2.5 text-xs ${align === "right" ? "text-right" : ""} ${bold ? "font-semibold" : ""} tabular-nums`} style={{ color: muted ? "var(--t-text-muted)" : "var(--t-text-primary)" }}>{children}</td>;
}

function EmptyRow() {
  return <p className="text-xs py-4 text-center" style={{ color: "var(--t-text-tertiary)" }}>No data for this period.</p>;
}
