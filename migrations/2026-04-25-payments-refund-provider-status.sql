-- Arc J.1 — Cancellation orchestrator
--
-- Adds payments.refund_provider_status to capture the lifecycle of a
-- refund issued as part of a cancellation decision. The orchestrator
-- writes one of:
--
--   pending_stripe   — Stripe refund attempted; awaiting API result
--   stripe_succeeded — Stripe refund succeeded; metadata.stripe_refund_id populated
--   stripe_failed    — Stripe refund failed post-commit; manual retry needed
--   manual_required  — Card payment without stripe_payment_intent_id (orphan
--                       shape: webhook-created or admin Mark-Paid). Operator
--                       refunds manually in the Stripe dashboard.
--   manual_completed — Cash payment. No programmatic refund possible.
--   NULL             — No refund attempted on this payment yet
--
-- Run via Supabase SQL editor BEFORE the API deploy. Idempotent.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refund_provider_status TEXT NULL;

COMMENT ON COLUMN payments.refund_provider_status IS
  'Arc J.1 cancellation refund lifecycle: pending_stripe | stripe_succeeded | stripe_failed | manual_required | manual_completed | NULL.';
