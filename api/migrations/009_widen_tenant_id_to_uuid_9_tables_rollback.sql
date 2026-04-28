-- 009_widen_tenant_id_to_uuid_9_tables_rollback.sql
--
-- Reverses 009_widen_tenant_id_to_uuid_9_tables.sql.
-- Returns tenant_id to varchar on 9 tables; drops and recreates quotes RLS policy identically.
--
-- ONLY run this if you need to roll 009 back. The cast uuid::text produces the canonical
-- hyphenated UUID format (e.g. '822481be-039e-481a-b5c4-21d9e002f16c'), identical to the
-- pre-009 stored representation per the audit's data-integrity check.
--
-- Any rows written between 009 going forward and this rollback will have tenant_id values
-- that are valid UUIDs (since the column was uuid-typed); they round-trip cleanly through
-- uuid::text back to varchar.
--
-- The recreated quotes_tenant_isolation policy is identical to the post-009 form
-- (which is itself identical to the pre-009 form).

BEGIN;

DROP POLICY quotes_tenant_isolation ON quotes;

ALTER TABLE ai_suggestion_log      ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE delivery_zones         ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE dump_tickets           ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE pricing_templates      ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE quotes                 ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE tenant_settings        ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE tenant_setup_checklist ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE time_entries           ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;
ALTER TABLE yards                  ALTER COLUMN tenant_id TYPE varchar USING tenant_id::text;

CREATE POLICY quotes_tenant_isolation ON quotes
  FOR ALL TO public
  USING ((tenant_id)::text = current_setting('app.tenant_id'::text));

COMMIT;
