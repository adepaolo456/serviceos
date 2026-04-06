-- Idempotency table for orchestration endpoint
-- Run in Supabase SQL editor before deploying Phase 4

CREATE TABLE IF NOT EXISTS orchestration_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

-- Index for lookup performance
CREATE INDEX IF NOT EXISTS idx_orchestration_results_lookup
  ON orchestration_results (tenant_id, idempotency_key)
  WHERE created_at > NOW() - INTERVAL '24 hours';

-- Auto-cleanup: remove results older than 24 hours (run periodically or via cron)
-- DELETE FROM orchestration_results WHERE created_at < NOW() - INTERVAL '24 hours';
