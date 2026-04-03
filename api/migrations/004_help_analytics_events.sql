-- ============================================================================
-- Help Analytics Events — Durable storage for Help Center usage tracking
-- ============================================================================

-- Group 1: Additive table creation
CREATE TABLE IF NOT EXISTS help_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  event_name VARCHAR(100) NOT NULL,
  feature_id VARCHAR(100),
  related_feature_id VARCHAR(100),
  page_path VARCHAR(255),
  source VARCHAR(50),
  search_query VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group 2: Indexes
CREATE INDEX IF NOT EXISTS idx_help_events_tenant ON help_analytics_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_help_events_feature ON help_analytics_events(feature_id);
CREATE INDEX IF NOT EXISTS idx_help_events_name ON help_analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_help_events_created ON help_analytics_events(created_at);

-- Rollback:
-- DROP TABLE IF EXISTS help_analytics_events;

-- ============================================================================
-- END MIGRATION
-- ============================================================================
