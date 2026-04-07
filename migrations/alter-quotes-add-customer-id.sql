-- ============================================================
-- ALTER quotes: add customer_id FK for proper relational linkage
-- Safe additive migration — run in Supabase SQL editor BEFORE deploy
-- ============================================================

-- Step 1: Add column (nullable, additive, safe)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

-- Step 2: Add composite index for tenant-scoped customer lookups
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(tenant_id, customer_id);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP INDEX IF EXISTS idx_quotes_customer;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS customer_id;
