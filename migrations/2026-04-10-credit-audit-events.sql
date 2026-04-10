-- Phase 7 — Credit Control Audit Events
-- Run in Supabase SQL editor BEFORE deploying the API.
-- synchronize:false — TypeORM does not manage this table.

CREATE TABLE IF NOT EXISTS credit_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'credit_hold_set',
      'credit_hold_released',
      'booking_override',
      'dispatch_override',
      'credit_policy_updated',
      'credit_settings_updated'
    )
  ),
  user_id UUID NOT NULL,
  customer_id UUID,
  job_id UUID,
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_audit_tenant_created
  ON credit_audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_audit_tenant_type
  ON credit_audit_events (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS idx_credit_audit_tenant_customer
  ON credit_audit_events (tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;
