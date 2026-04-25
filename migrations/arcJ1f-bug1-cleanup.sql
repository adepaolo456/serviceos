-- Arc J.1f-bug1 — clear stale assigned_driver_id from cancelled jobs.
-- ⚠ Run AFTER deploying the code fix that prevents new stale rows.
-- Pattern mirrors Arc H's cleanup_leaked_driver_assignments_arc_h.sql.
-- Tenant: 822481be-039e-481a-b5c4-21d9e002f16c (Rent This Dumpster).

-- ── Dry-run (verify count expected to be cleared):
SELECT COUNT(*) AS rows_to_clean
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'cancelled'
  AND assigned_driver_id IS NOT NULL;

-- ── Apply (returns affected rows for verification):
UPDATE jobs
SET assigned_driver_id = NULL
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'cancelled'
  AND assigned_driver_id IS NOT NULL
RETURNING id, job_number;

-- ── Post-apply verification (should return 0):
SELECT COUNT(*) AS leftover_stale
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'cancelled'
  AND assigned_driver_id IS NOT NULL;
