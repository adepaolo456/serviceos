-- Customer Dashboard Pass 1 — driver instructions field
--
-- Adds a dedicated free-text field to separate driver instructions from
-- internal office notes on the customer record. Nullable, additive only.
-- Customer-visible notes are deferred (brief: "future use"), so this pass
-- only introduces the driver bucket.
--
-- No backfill required. Existing customers start with NULL which the UI
-- renders as "Not configured". Existing customer.notes field is unchanged
-- and continues to hold internal notes by convention.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS driver_instructions TEXT NULL;
