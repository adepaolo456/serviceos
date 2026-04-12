-- Migration: tenant_settings.timezone
-- Phase B3 — Tenant-aware timezone system.
--
-- Adds the tenant-wide canonical timezone column. Enables tenant-aware
-- date helpers so "today", date-range filters, and server-side
-- detectors stop rolling into tomorrow at UTC midnight.
--
-- Additive and idempotent — safe to re-run. New column defaults to
-- 'America/New_York' so existing tenants with no explicit setting
-- keep working without any application-level migration. NOT NULL
-- with a DEFAULT means Postgres 11+ backfills existing rows on the
-- ALTER itself — no separate UPDATE pass required.
--
-- Production usage: paste into Supabase SQL editor and run BEFORE
-- API deploy. Project rule: synchronize: false — TypeORM does not
-- add this column automatically.
BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMIT;
