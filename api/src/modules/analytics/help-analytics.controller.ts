import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { TenantId, CurrentUser } from '../../common/decorators';
import { HelpAnalyticsEvent } from './entities/help-analytics-event.entity';

@ApiTags('Help Analytics')
@ApiBearerAuth()
@Controller('help-analytics')
export class HelpAnalyticsController {
  constructor(
    @InjectRepository(HelpAnalyticsEvent)
    private repo: Repository<HelpAnalyticsEvent>,
  ) {}

  @Post('events')
  @ApiOperation({ summary: 'Record a help analytics event (fire-and-forget)' })
  async recordEvent(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: {
      eventName: string;
      featureId?: string;
      relatedFeatureId?: string;
      pagePath?: string;
      source?: string;
      searchQuery?: string;
    },
  ) {
    try {
      await this.repo.save(this.repo.create({
        tenant_id: tenantId,
        user_id: userId || null,
        event_name: body.eventName,
        feature_id: body.featureId || null,
        related_feature_id: body.relatedFeatureId || null,
        page_path: body.pagePath || null,
        source: body.source || null,
        search_query: body.searchQuery || null,
      }));
    } catch { /* fire-and-forget */ }
    return { ok: true };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Help analytics summary (admin)' })
  async summary(
    @TenantId() tenantId: string,
    @Query('days') daysStr?: string,
  ) {
    const days = parseInt(daysStr || '30', 10) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const events = await this.repo.find({
      where: { tenant_id: tenantId, created_at: MoreThanOrEqual(since) },
      order: { created_at: 'DESC' },
    });

    let topicViews = 0;
    let tooltipClicks = 0;
    let searches = 0;
    let relatedClicks = 0;
    let invalidDeepLinks = 0;
    const featureViewCounts = new Map<string, number>();
    const featureTooltipCounts = new Map<string, number>();
    const featureRelatedCounts = new Map<string, number>();
    const searchCounts = new Map<string, number>();
    const relatedPairs = new Map<string, number>();
    const orphanedFeatureIds = new Set<string>();

    for (const e of events) {
      switch (e.event_name) {
        case 'help_topic_viewed':
          topicViews++;
          if (e.feature_id) featureViewCounts.set(e.feature_id, (featureViewCounts.get(e.feature_id) || 0) + 1);
          break;
        case 'help_tooltip_learn_more_clicked':
          tooltipClicks++;
          if (e.feature_id) featureTooltipCounts.set(e.feature_id, (featureTooltipCounts.get(e.feature_id) || 0) + 1);
          break;
        case 'help_search_used':
          searches++;
          if (e.search_query) {
            const q = e.search_query.toLowerCase().trim();
            searchCounts.set(q, (searchCounts.get(q) || 0) + 1);
          }
          break;
        case 'help_related_topic_clicked':
          relatedClicks++;
          if (e.feature_id) featureRelatedCounts.set(e.feature_id, (featureRelatedCounts.get(e.feature_id) || 0) + 1);
          if (e.feature_id && e.related_feature_id) {
            const key = `${e.feature_id}→${e.related_feature_id}`;
            relatedPairs.set(key, (relatedPairs.get(key) || 0) + 1);
          }
          break;
        case 'help_topic_not_found':
          invalidDeepLinks++;
          if (e.feature_id) orphanedFeatureIds.add(e.feature_id);
          break;
      }
    }

    // Collect all referenced featureIds for registry resolution on client
    const allFeatureIds = new Set<string>();
    for (const id of featureViewCounts.keys()) allFeatureIds.add(id);
    for (const id of featureTooltipCounts.keys()) allFeatureIds.add(id);
    for (const id of featureRelatedCounts.keys()) allFeatureIds.add(id);

    const topTopics = Array.from(featureViewCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([featureId, count]) => ({ featureId, views: count }));

    const topTooltips = Array.from(featureTooltipCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([featureId, count]) => ({ featureId, clicks: count }));

    const topSearches = Array.from(searchCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([query, count]) => ({ query, count }));

    const topRelatedPairs = Array.from(relatedPairs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([pair, count]) => {
        const [from, to] = pair.split('→');
        return { fromFeatureId: from, toFeatureId: to, count };
      });

    // Demand scores
    const demandMap = new Map<string, { views: number; tooltips: number; related: number }>();
    for (const [id, v] of featureViewCounts) demandMap.set(id, { views: v, tooltips: 0, related: 0 });
    for (const [id, v] of featureTooltipCounts) {
      const d = demandMap.get(id) || { views: 0, tooltips: 0, related: 0 };
      d.tooltips = v;
      demandMap.set(id, d);
    }
    for (const [id, v] of featureRelatedCounts) {
      const d = demandMap.get(id) || { views: 0, tooltips: 0, related: 0 };
      d.related = v;
      demandMap.set(id, d);
    }

    const demandScores = Array.from(demandMap.entries())
      .map(([featureId, d]) => ({
        featureId,
        views: d.views,
        tooltips: d.tooltips,
        related: d.related,
        score: d.views + d.tooltips + d.related,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    return {
      days,
      totals: {
        topicViews,
        tooltipClicks,
        searches,
        relatedClicks,
        invalidDeepLinks,
        distinctFeaturesViewed: allFeatureIds.size,
        distinctSearchQueries: searchCounts.size,
      },
      topTopics,
      topTooltips,
      topSearches,
      topRelatedPairs,
      demandScores,
      orphanedFeatureIds: Array.from(orphanedFeatureIds),
    };
  }
}
