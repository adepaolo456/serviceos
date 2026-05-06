-- 013_payment_intent_id_unique.sql
-- arcV Phase 1: payment_intent_id index foundation
-- Audit: docs/audits/2026-04-30-pr-c2-webhook-dedup-audit.md § D-4
-- Issue: #29 (Phase 1 of 2 — Phase 2 lands handler conversions in a separate PR)
--
-- Rationale (audit D-4):
--   PR-C2 Site 4 dedup is defense-in-depth: even with stripe_events entry-point
--   dedup, Site 4 must still call paymentRepo.findOne({ where: { stripe_payment_intent_id } })
--   before paymentRepo.save. The audit calls this lookup "one indexed lookup; cost is
--   negligible" — that performance assumption depends on this index existing.
--
-- Preflight (run 2026-05-06 against ServiceOS prod, project voczrzbdukgdrirmlgfw):
--   Duplicates query (tenant_id, stripe_payment_intent_id WHERE NOT NULL): 0 rows
--   Totals: total_payments=12, with_pi_id=0, distinct_pi_ids=0, distinct_tenant_pi_pairs=1
--   Decision: UNIQUE variant — zero existing duplicates, partial WHERE NOT NULL excludes
--   the 12 NULL-pi rows from the index entirely. UNIQUE only applies to future rows that
--   carry a Stripe payment_intent ID, providing a hard DB-level dedup guarantee that
--   complements the application-layer findOne guard.
--
-- Index shape:
--   - Tenant-scoped composite (tenant_id, stripe_payment_intent_id) preserves multi-tenant
--     isolation per CLAUDE.md MULTI-TENANT SAFE rule.
--   - Partial WHERE stripe_payment_intent_id IS NOT NULL excludes pre-Stripe-Live rows.
--   - CONCURRENTLY: required convention for prod safety even on small tables (no write
--     lock on payments). Cannot run inside a transaction — the Supabase SQL editor runs
--     statements outside an implicit transaction by default, so this is safe to paste in.
--
-- Run order: Supabase SQL editor BEFORE API deploy (synchronize: isTest in app.module.ts:80
--            means TypeORM does NOT auto-create indexes in prod).

-- ============================================================================
-- Group 1: Index DDL
-- ============================================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_pi_unique
  ON payments (tenant_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================================================
-- Verification SELECTs (run after CREATE above)
-- ============================================================================

-- Should return 1 row: idx_payments_tenant_pi_unique | CREATE UNIQUE INDEX ... ON public.payments USING btree (tenant_id, stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL)
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'payments'
  AND indexname = 'idx_payments_tenant_pi_unique';

-- Index validity check (CONCURRENTLY can leave an INVALID index if it fails mid-build).
-- Should return 1 row with indisvalid = true and indisready = true.
SELECT
  c.relname AS indexname,
  i.indisvalid,
  i.indisready,
  i.indisunique
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'idx_payments_tenant_pi_unique';

-- ============================================================================
-- Rollback (DO NOT run unless reverting)
-- ============================================================================

-- DROP INDEX CONCURRENTLY IF EXISTS idx_payments_tenant_pi_unique;
