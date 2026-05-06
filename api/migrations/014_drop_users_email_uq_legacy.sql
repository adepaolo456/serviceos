-- 014_drop_users_email_uq_legacy.sql
-- arcW: drop redundant users-table case-sensitive unique constraint
-- Audit reference: 2026-05-04 email-uniqueness audit + memory followup
-- Issue: #116
--
-- Rationale:
--   The users table had two unique surfaces on email:
--     1. UQ_97672ac88f789774dd47f7c8be3 — TypeORM-generated UNIQUE CONSTRAINT
--        on (email), case-sensitive. Backed by an auto-named btree index of
--        the same name.
--     2. users_email_lower_unique — full unique expression INDEX on
--        LOWER((email)::text). Not partial. Rejects all case-insensitive
--        duplicates including empty-string ('' becomes a value, not NULL,
--        when LOWER'd).
--   Surface (2) fully shadows surface (1) — anything (1) catches, (2) also
--   catches (and more). Holding both wastes index maintenance on every
--   users INSERT/UPDATE.
--
-- Audit gap caught at Phase 0 retry (2026-05-06):
--   pg_indexes alone is insufficient to characterize unique constraints —
--   UQ_-prefixed names are TypeORM-generated constraint names whose backing
--   index appears in pg_indexes but cannot be dropped via DROP INDEX. Future
--   audits of unique constraints must also query pg_constraint or
--   information_schema.table_constraints to surface the constraint
--   relationship.
--
-- Lock posture:
--   ALTER TABLE ... DROP CONSTRAINT has no CONCURRENTLY variant. Postgres
--   takes ACCESS EXCLUSIVE on users for the duration of the operation
--   (catalog work only — does not scan rows). On the current 6-row users
--   table this is a sub-millisecond catalog operation. Future invocations
--   on a populated users table would still be fast (no row scan), but the
--   exclusive lock means concurrent reads/writes block briefly. Acceptable
--   risk for a redundant-constraint drop on a small administrative table.
--
-- Preflight (run 2026-05-06 against ServiceOS prod, project voczrzbdukgdrirmlgfw):
--   P0.1 — Both surfaces present:
--          UQ_97672ac88f789774dd47f7c8be3 → unique constraint (case-sensitive)
--          users_email_lower_unique       → unique expression index
--          Both indisvalid=true, indisready=true, indisunique=true.
--   P0.2 — user_count=6, distinct_email_count=6, distinct_lower_email_count=6,
--          null_email_count=0. No latent inconsistency.
--   P0.3 — 2 named refs + 4 substring refs in api/src/modules/auth/auth.service.ts
--          (defensive OR-fallbacks for unique-violation error translation).
--          Cleaned in arcW commit 1 (refactor) before this drop.
--
-- Run order inversion: DROP already shipped to prod via Supabase MCP
-- execute_sql before this PR opened (same pattern as arcV Phase 1 PR #114
-- — preview env unavailable on Free plan, prod-side verification justified
-- on read-only DDL with zero remaining app dependencies post-cleanup).
--
-- Out of scope:
--   - users_email_lower_unique untouched (the canonical surviving constraint).
--   - Magic-link / auth-flow changes.
--   - FK-coverage gap (separate hygiene card).
--   - Other index hygiene (separate audit).

-- ============================================================================
-- Group 1: Drop the redundant constraint (and its backing index, atomically)
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS "UQ_97672ac88f789774dd47f7c8be3";

-- ============================================================================
-- Verification SELECTs (run after the ALTER above)
-- ============================================================================

-- Should return 0 rows: constraint is gone.
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.users'::regclass
  AND conname = 'UQ_97672ac88f789774dd47f7c8be3';

-- Should return 0 rows: backing index dropped atomically with the constraint.
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'users'
  AND indexname = 'UQ_97672ac88f789774dd47f7c8be3';

-- Should return 1 row: surviving expression index still present and valid.
SELECT
  c.relname AS indexname,
  i.indisvalid,
  i.indisready,
  i.indisunique
FROM pg_class c
JOIN pg_index i ON c.oid = i.indexrelid
WHERE c.relname = 'users_email_lower_unique';

-- ============================================================================
-- Rollback (DO NOT run unless reverting)
-- ============================================================================

-- ALTER TABLE users
--   ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);
