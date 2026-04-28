-- 010_comment_quotes_rls_policy.sql
--
-- Adds an explanatory COMMENT ON POLICY to quotes_tenant_isolation,
-- recording why this RLS policy diverges from the canonical
-- auth.jwt() pattern used by the other 15 policies on the schema.
--
-- Companion rollback: 010_comment_quotes_rls_policy_rollback.sql
--
-- Threat model: Option 1 (RLS as defense-in-depth only)
--   per docs/audits/2026-04-28-rls-threat-model.md.
--
-- Precedent: this migration is metadata-only. No DDL touches policy
-- expression, no data is modified, no rows are read or written.
-- Failure mode is a no-op (the policy retains its current NULL comment).

BEGIN;

COMMENT ON POLICY quotes_tenant_isolation ON quotes IS
'Intentional RLS outlier. ServiceOS uses RLS as defense-in-depth for non-API/direct Supabase access; the NestJS API connects with a bypassing role and enforces tenant isolation in the app layer. This policy uses app.tenant_id instead of the canonical auth.jwt tenant claim because quotes may be reached by token/portal-style flows without a Supabase JWT. Both forms fail closed for non-bypassing roles, which satisfies the defense-in-depth threat model; convergence with the canonical pattern is acknowledged but not planned.';

COMMIT;
