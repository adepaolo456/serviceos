-- 009_widen_tenant_id_to_uuid_9_tables.sql
--
-- Widens tenant_id from varchar to uuid across 9 tables.
-- Companion rollback: 009_widen_tenant_id_to_uuid_9_tables_rollback.sql
--
-- Precedent: api/migrations/008_customer_notes_align_schema.sql (commit 9c32597) —
--   in-place, single-transaction, comma-chained ALTER COLUMN ... TYPE uuid USING x::uuid.
--   This migration extends that pattern with explicit DROP/RECREATE of one dependent
--   RLS policy (quotes_tenant_isolation) and adds a rollback companion (008 had none).
--
-- Threat model: Option 1 (RLS as defense-in-depth only)
--   per docs/audits/2026-04-28-rls-threat-model.md.
-- This migration does NOT change enforcement posture, claims injection, or connection role.
--
-- Tables affected (all CLEAN per audit-tenant-id-varchar-to-uuid-9-tables.md):
--   ai_suggestion_log, delivery_zones, dump_tickets, pricing_templates,
--   quotes, tenant_settings, tenant_setup_checklist, time_entries, yards
--
-- Dependent: quotes_tenant_isolation RLS policy — dropped before ALTER and recreated
--   IDENTICALLY (same expression, same role target {public}, same cmd ALL) afterward.
--
-- Run order:
--   1. Pre-flight verification queries (separate block in the implementation prompt)
--   2. This file in Supabase SQL editor
--   3. Post-flight verification queries
--   4. Commit the two .sql files to repo (separate commit, post-execution)
--   5. Run the entity-decoration code prompt (separate prompt)
--   6. API deploy

BEGIN;

DROP POLICY quotes_tenant_isolation ON quotes;

ALTER TABLE ai_suggestion_log      ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE delivery_zones         ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE dump_tickets           ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE pricing_templates      ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE quotes                 ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE tenant_settings        ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE tenant_setup_checklist ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE time_entries           ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE yards                  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

CREATE POLICY quotes_tenant_isolation ON quotes
  FOR ALL TO public
  USING ((tenant_id)::text = current_setting('app.tenant_id'::text));

COMMIT;
