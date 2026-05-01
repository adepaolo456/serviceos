-- 012_stripe_events_dedup.sql
-- PR-C2-pre: Webhook event dedup table
-- Audit: docs/audits/2026-04-30-pr-c2-webhook-dedup-audit.md
-- Decision D-1: surrogate UUID PK + unique compound index on (tenant_id, event_id)
-- Decision D-3: atomic INSERT...ON CONFLICT DO NOTHING RETURNING id at handleWebhook entry point
-- Decision D-5: this migration ships as PR-C2-pre; PR-C2 (Sites 3+4 bypass replacements) ships separately
--
-- Nullable tenant_id required for account.updated (cross-tenant Stripe Connect events
-- have no payload-derivable tenant — best-effort dedup acceptable per audit D-1 rationale).
-- Money-movement events (payment_intent.*, checkout.session.completed) MUST resolve
-- tenant_id from event payload — application-layer enforcement, not DB-enforced.
--
-- Run order: SQL editor BEFORE API deploy (TypeORM synchronize: false in dev/prod).

-- ============================================================================
-- Group 1: Safe additive (table + index)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique compound index for dedup. Nullable tenant_id means PostgreSQL treats
-- two NULL tenant_ids as DISTINCT (per SQL standard) — this is acceptable for
-- account.updated events per audit D-1 rationale.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_events_tenant_event
  ON stripe_events (tenant_id, event_id);

-- Helpful lookup index for retention prune (issue #32, future).
-- TODO when retention prune lands: CREATE INDEX idx_stripe_events_processed_at ON stripe_events (processed_at);

-- ============================================================================
-- Verification SELECTs (run after CREATEs above)
-- ============================================================================

-- Should return 1 row: stripe_events | 6
SELECT
  'stripe_events' AS table_name,
  COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stripe_events';

-- Should return 1 row: uq_stripe_events_tenant_event | CREATE UNIQUE INDEX ... ON public.stripe_events USING btree (tenant_id, event_id)
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'stripe_events'
  AND indexname = 'uq_stripe_events_tenant_event';

-- ============================================================================
-- Rollback (DO NOT run unless reverting)
-- ============================================================================

-- DROP INDEX IF EXISTS uq_stripe_events_tenant_event;
-- DROP TABLE IF EXISTS stripe_events;
