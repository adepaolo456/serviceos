-- ============================================================
-- BACKFILL quotes.customer_id from exact tenant-scoped email match
-- Run AFTER alter-quotes-add-customer-id.sql
-- Safe to re-run (only updates NULL customer_id rows)
-- ============================================================

-- Preview: show counts before running
-- Matched (will be updated):
SELECT COUNT(*) AS will_backfill
FROM quotes q
WHERE q.customer_id IS NULL
  AND q.customer_email IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM customers c
    WHERE c.tenant_id = q.tenant_id
      AND LOWER(TRIM(c.email)) = LOWER(TRIM(q.customer_email))
    HAVING COUNT(*) = 1
  );

-- Ambiguous (will be skipped — multiple customers with same email in same tenant):
SELECT COUNT(*) AS ambiguous_skipped
FROM quotes q
WHERE q.customer_id IS NULL
  AND q.customer_email IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM customers c
    WHERE c.tenant_id = q.tenant_id
      AND LOWER(TRIM(c.email)) = LOWER(TRIM(q.customer_email))
    HAVING COUNT(*) > 1
  );

-- Unmatched (no customer found — will remain NULL):
SELECT COUNT(*) AS unmatched
FROM quotes q
WHERE q.customer_id IS NULL
  AND q.customer_email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customers c
    WHERE c.tenant_id = q.tenant_id
      AND LOWER(TRIM(c.email)) = LOWER(TRIM(q.customer_email))
  );

-- ============================================================
-- EXECUTE BACKFILL
-- ============================================================
UPDATE quotes q
SET customer_id = (
  SELECT c.id FROM customers c
  WHERE c.tenant_id = q.tenant_id
    AND LOWER(TRIM(c.email)) = LOWER(TRIM(q.customer_email))
  HAVING COUNT(*) = 1
  LIMIT 1
)
WHERE q.customer_id IS NULL
  AND q.customer_email IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM customers c
    WHERE c.tenant_id = q.tenant_id
      AND LOWER(TRIM(c.email)) = LOWER(TRIM(q.customer_email))
    HAVING COUNT(*) = 1
  );

-- Verify: count remaining NULL customer_id quotes
SELECT
  COUNT(*) FILTER (WHERE customer_id IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE customer_id IS NULL) AS unlinked,
  COUNT(*) AS total
FROM quotes;
