-- Arc J.1f-bug2 — correct the single known stale refunded_amount write.
-- ⚠ Run AFTER deploying the code fix that prevents new stale writes.
-- Targets Maria Santos's payment from smoke #1' (payment 19bd0192-…, $850).
-- Tenant: 822481be-039e-481a-b5c4-21d9e002f16c.

-- ── Dry-run (confirm the row matches before applying):
SELECT id, amount, refunded_amount, refund_provider_status
FROM payments
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND id = '19bd0192-2d27-4e9b-9577-45d7983e969e'
  AND refund_provider_status = 'manual_required'
  AND refunded_amount = 850;

-- ── Apply (RETURNING for confirmation; guard prevents re-running after manual refund):
UPDATE payments
SET refunded_amount = 0
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND id = '19bd0192-2d27-4e9b-9577-45d7983e969e'
  AND refund_provider_status = 'manual_required'
  AND refunded_amount = 850
RETURNING id, refunded_amount, refund_provider_status;

-- ── Post-apply verification (should return the row with refunded_amount = 0):
SELECT id, refunded_amount, refund_provider_status
FROM payments
WHERE id = '19bd0192-2d27-4e9b-9577-45d7983e969e'
  AND tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c';
