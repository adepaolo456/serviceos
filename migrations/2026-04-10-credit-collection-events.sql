-- Phase 11 — Credit Collection Events (manual workflow actions)
-- Run in Supabase SQL editor BEFORE deploying the API.

CREATE TABLE IF NOT EXISTS credit_collection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'reminder_sent',
      'marked_contacted',
      'note_added',
      'escalated'
    )
  ),
  note TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_events_customer
  ON credit_collection_events (tenant_id, customer_id, created_at DESC);
