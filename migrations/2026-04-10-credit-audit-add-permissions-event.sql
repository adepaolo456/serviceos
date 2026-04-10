-- Phase 10 — Extend credit_audit_events CHECK constraint to allow
-- 'team_permissions_updated' event type.
-- Run in Supabase SQL editor BEFORE deploying the API.

ALTER TABLE credit_audit_events
  DROP CONSTRAINT IF EXISTS credit_audit_events_event_type_check;

ALTER TABLE credit_audit_events
  ADD CONSTRAINT credit_audit_events_event_type_check CHECK (
    event_type IN (
      'credit_hold_set',
      'credit_hold_released',
      'booking_override',
      'dispatch_override',
      'credit_policy_updated',
      'credit_settings_updated',
      'team_permissions_updated'
    )
  );
