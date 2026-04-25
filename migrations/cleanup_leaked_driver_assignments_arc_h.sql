-- Arc H — Cleanup: null assigned_driver_id on jobs leaked into terminal states.
--
-- Background: pre-Arc-H, the changeStatus path used Repository.save(entity)
-- on a fully-loaded Job entity. TypeORM rehydrated assigned_driver_id from
-- the loaded `assigned_driver` relation, silently overwriting explicit nulls.
-- Combined with UNASSIGNED_TARGETS not including cancelled/completed/failed,
-- terminal-state jobs accumulated stale FKs (audit archH-phase0-audit-report.md
-- § 9 — 16 leaked rows in tenant 822481be).
--
-- This script is run MANUALLY by Anthony in Supabase SQL editor AFTER the
-- Arc H API deploy (commit landing on `main`). The reverse order would leave
-- a window where ongoing cancellations create new leaks faster than the
-- cleanup nulls them.
--
-- Idempotent: re-running after the API fix lands has zero effect because
-- the API no longer creates new leaks and this script's WHERE clause
-- requires `assigned_driver_id IS NOT NULL`.

-- ─────────────────────────────────────────────────────────────────────────
-- Step 0 — snapshot (run BEFORE the UPDATE; copy output for rollback file).
-- The snapshot captures every (id, assigned_driver_id) pair that's about
-- to be nulled. Save the rows somewhere durable in case rollback is needed.
-- ─────────────────────────────────────────────────────────────────────────
SELECT id, job_number, status, assigned_driver_id, updated_at
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL
ORDER BY status, job_number;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1 — count check. Cross-reference with audit archH-phase0 § 9.
-- Expected at audit time: 16 rows. ±2 acceptable for cancellations
-- between audit and cleanup; abort if delta is larger.
-- ─────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS rows_to_clear
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2 — terminal-status cleanup UPDATE. RETURNING gives an audit trail
-- of exactly which rows were touched.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE jobs
SET assigned_driver_id = NULL,
    updated_at = NOW()
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL
RETURNING id, job_number, status;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3 — defensive single-row update for JOB-20260409-003-P (Bug 1's
-- documented victim). Status is `confirmed` (NOT terminal), so it isn't
-- caught by Step 2; it's the canonical override-to-Unassigned case that
-- failed under the relation-rehydration bug. Matched by id + status +
-- driver to avoid clobbering if a re-assignment happened between audit
-- and cleanup.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE jobs
SET assigned_driver_id = NULL,
    updated_at = NOW()
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND id = '3d24ab96-5f99-43f3-ba50-6817c7e03888'
  AND status = 'confirmed'
  AND assigned_driver_id = 'f86c8546-528d-40ee-9f8b-942b79ebc821'
RETURNING id, job_number, status;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4 — verification. After running Steps 2 + 3, this should return 0.
-- ─────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS leftover_leaks
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND (
    (status IN ('cancelled', 'completed', 'failed') AND assigned_driver_id IS NOT NULL)
    OR (id = '3d24ab96-5f99-43f3-ba50-6817c7e03888'
        AND assigned_driver_id IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback (if needed within the same window): re-apply the snapshot
-- captured in Step 0 by issuing per-row UPDATEs. Each UPDATE must be
-- scoped by id AND tenant_id AND `assigned_driver_id IS NULL` so a
-- subsequent legitimate re-assignment isn't clobbered.
--
-- Example shape (replace placeholders with values from the Step 0 output):
--
--   UPDATE jobs
--   SET assigned_driver_id = '<original_driver_id_from_snapshot>'
--   WHERE id = '<id_from_snapshot>'
--     AND tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
--     AND assigned_driver_id IS NULL;
--
-- DO NOT rollback if production has been running with the new behavior
-- for any meaningful window — the FK nulls are the correct production
-- state going forward; restoring them would re-introduce the leak.
