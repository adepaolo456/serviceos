-- ============================================================
-- ALTER quotes table: add token, distance_surcharge, fix defaults
-- Safe additive migration — run in Supabase SQL editor BEFORE deploy
-- ============================================================

-- Group 1: Add new columns (additive, safe)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS token VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS distance_surcharge DECIMAL(10, 2) DEFAULT 0;

-- Group 2: Change status default from 'sent' to 'draft'
ALTER TABLE quotes
  ALTER COLUMN status SET DEFAULT 'draft';

-- Group 3: Add status check constraint if not present
-- (old table had no check constraint — add one matching the prompt spec)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_status_check'
  ) THEN
    ALTER TABLE quotes
      ADD CONSTRAINT quotes_status_check
      CHECK (status IN ('draft', 'sent', 'expired', 'converted'));
  END IF;
END $$;

-- Group 4: Add index on token for fast lookup (if not present)
CREATE INDEX IF NOT EXISTS idx_quotes_token ON quotes(token);

-- Group 5: Add index on tenant_id (if not present)
CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON quotes(tenant_id);

-- Group 6: Enable RLS and add tenant isolation policy (if not present)
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'quotes_tenant_isolation' AND tablename = 'quotes'
  ) THEN
    CREATE POLICY quotes_tenant_isolation
      ON quotes
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (run these to undo if needed)
-- ============================================================
-- ALTER TABLE quotes DROP COLUMN IF EXISTS token;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS distance_surcharge;
-- ALTER TABLE quotes ALTER COLUMN status SET DEFAULT 'sent';
-- ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
-- DROP INDEX IF EXISTS idx_quotes_token;
-- DROP INDEX IF EXISTS idx_quotes_tenant;
-- DROP POLICY IF EXISTS quotes_tenant_isolation ON quotes;
