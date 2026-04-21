-- customer_notes schema alignment
--
-- Converts FK-like columns from varchar to uuid, adds proper FK constraints,
-- and adds compound index for tenant-scoped customer note queries.
--
-- Safe because customer_notes has 0 rows in production (verified Apr 21 2026);
-- the USING x::uuid casts have no data to fail on.
--
-- FK delete-rule strategy:
--   customer_id → NO ACTION (ownership; consistent with other 9 customer FKs)
--   tenant_id   → NO ACTION (ownership)
--   author_id   → SET NULL (attribution; notes survive user deletion)

BEGIN;

-- Column type corrections (varchar -> uuid)
ALTER TABLE customer_notes
  ALTER COLUMN customer_id TYPE uuid USING customer_id::uuid,
  ALTER COLUMN tenant_id   TYPE uuid USING tenant_id::uuid,
  ALTER COLUMN author_id   TYPE uuid USING author_id::uuid;

-- FK constraints
ALTER TABLE customer_notes
  ADD CONSTRAINT fk_customer_notes_customer_id
    FOREIGN KEY (customer_id) REFERENCES customers(id);

ALTER TABLE customer_notes
  ADD CONSTRAINT fk_customer_notes_tenant_id
    FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE customer_notes
  ADD CONSTRAINT fk_customer_notes_author_id
    FOREIGN KEY (author_id) REFERENCES users(id)
    ON DELETE SET NULL;

-- Compound index for loadInternalNotes() query pattern
CREATE INDEX idx_customer_notes_tenant_customer_created
  ON customer_notes(tenant_id, customer_id, created_at DESC);

COMMIT;
