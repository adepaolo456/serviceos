-- 010_comment_quotes_rls_policy_rollback.sql
--
-- Reverses 010_comment_quotes_rls_policy.sql by clearing the
-- COMMENT ON POLICY back to NULL.
--
-- ONLY run this if you need to roll 010 back. The policy expression
-- itself is untouched by either 010 or this rollback; only the
-- pg_description metadata row is added or removed.

BEGIN;

COMMENT ON POLICY quotes_tenant_isolation ON quotes IS NULL;

COMMIT;
