/**
 * Help Center usage tracking — fire-and-forget, registry-enforced.
 * All feature metadata resolved from FEATURE_REGISTRY — never hardcoded.
 * Events persist to POST /help-analytics/events.
 */

import { getFeature } from "./feature-registry";
import { api } from "./api";

export type HelpAnalyticsSource =
  | "direct"
  | "tooltip"
  | "search"
  | "related_topics"
  | "unknown";

interface HelpAnalyticsPayload {
  tenantId?: string;
  userId?: string;
  featureId?: string;
  category?: string;
  pagePath?: string;
  source?: HelpAnalyticsSource;
  searchQuery?: string;
  relatedFeatureId?: string;
  relatedCategory?: string;
}

function track(event: string, payload: HelpAnalyticsPayload): void {
  try {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[HelpAnalytics] ${event}`, payload);
    }
    // Persist to backend — fire-and-forget
    api.post("/help-analytics/events", {
      eventName: event,
      featureId: payload.featureId,
      relatedFeatureId: payload.relatedFeatureId,
      pagePath: payload.pagePath,
      source: payload.source,
      searchQuery: payload.searchQuery,
    }).catch(() => {}); // silent failure
  } catch {
    // Fire-and-forget — never break the UI
  }
}

export function trackHelpCenterViewed(payload: {
  tenantId?: string; userId?: string; pagePath?: string; source?: HelpAnalyticsSource;
}): void {
  track("help_center_viewed", payload);
}

export function trackHelpTopicViewed(payload: {
  tenantId?: string; userId?: string; featureId: string; pagePath?: string; source?: HelpAnalyticsSource;
}): void {
  const feature = getFeature(payload.featureId);
  if (!feature) return;
  track("help_topic_viewed", { ...payload, category: feature.category });
}

export function trackHelpTooltipLearnMoreClicked(payload: {
  tenantId?: string; userId?: string; featureId: string; pagePath?: string;
}): void {
  const feature = getFeature(payload.featureId);
  if (!feature) return;
  track("help_tooltip_learn_more_clicked", { ...payload, category: feature.category, source: "tooltip" });
}

export function trackHelpSearchUsed(payload: {
  tenantId?: string; userId?: string; pagePath?: string; searchQuery: string;
}): void {
  track("help_search_used", { ...payload, source: "search" });
}

export function trackHelpRelatedTopicClicked(payload: {
  tenantId?: string; userId?: string; featureId: string; relatedFeatureId: string; pagePath?: string;
}): void {
  const from = getFeature(payload.featureId);
  const to = getFeature(payload.relatedFeatureId);
  if (!from || !to) return;
  track("help_related_topic_clicked", {
    ...payload, category: from.category, relatedCategory: to.category, source: "related_topics",
  });
}

export function trackHelpTopicNotFound(payload: {
  tenantId?: string; userId?: string; featureId: string; pagePath?: string;
}): void {
  track("help_topic_not_found", payload);
}
