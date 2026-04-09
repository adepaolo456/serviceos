-- Migration: sms_opt_outs
-- Creates tenant-scoped SMS suppression storage for STOP/START compliance.
-- Additive and idempotent — safe to re-run. No changes to existing tables.
--
-- Production usage: paste into Supabase SQL editor and run BEFORE API deploy.
-- Project rule: synchronize: false — TypeORM does not create this table.
BEGIN;

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID         NOT NULL,
  phone_e164                VARCHAR(20)  NOT NULL,
  opted_out_at              TIMESTAMPTZ  NOT NULL,
  opted_out_via_message_id  UUID         NULL
    REFERENCES sms_messages(id) ON DELETE SET NULL,
  opted_in_at               TIMESTAMPTZ  NULL,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Enforces "one row per (tenant, phone)" AND provides O(1) lookup for the
-- send-path suppression gate. Upserts use this as the ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_opt_outs_tenant_phone
  ON sms_opt_outs (tenant_id, phone_e164);

COMMIT;
