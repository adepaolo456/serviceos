-- Phase 1 — Team page feature completion: soft-delete, owner-transfer,
-- last-owner invariant, audit logging.
--
-- Three additions to support the new endpoints in TeamController:
--   1. `users.deleted_at` column      → soft-delete semantics (DELETE /team/:id)
--   2. `user_audit_log` table         → append-only audit of lifecycle events
--   3. last-owner invariant trigger   → defense-in-depth mirror of
--                                       UsersService.assertNotLastOwner()
--
-- Why defense-in-depth: UsersService.assertNotLastOwner() fails-fast at the
-- service layer and raises a clean 400. The trigger is a safety net for any
-- future caller (direct SQL, console script, forgotten service-layer path)
-- that bypasses the service. Both sides use the same
-- `cannot_remove_last_owner:` prefix so the error is recognizable whether
-- raised by NestJS or Postgres.
--
-- Deploy order (per sign-off):
--   1. Run THIS file in Supabase SQL editor
--   2. Verify with the three post-apply queries at the bottom
--   3. Deploy api/ code that depends on these schema pieces
--
-- synchronize: false in production (see app.module.ts L66) — TypeORM will
-- not create these objects automatically. Test DB synthesizes columns from
-- the entity decorators (synchronize: true under NODE_ENV=test) but does
-- NOT run migrations, so unit tests do not get the trigger. Integration
-- tests that need trigger coverage must run against a migrated DB.

BEGIN;

-- ── 1. users.deleted_at ─────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

COMMENT ON COLUMN users.deleted_at IS
  'Soft-delete marker. NULL = live row. NOT NULL = hidden from every UI and '
  'list query. Preserves FK integrity (jobs.assigned_driver_id, audit records, '
  'etc.) without hard-deleting. Set by DELETE /team/:id via UsersService.';

-- ── 2. Partial indexes ──────────────────────────────────────────────────────
-- Accelerate the two hot paths: default team list, and last-owner check.

CREATE INDEX IF NOT EXISTS idx_users_tenant_active_nondeleted
  ON users (tenant_id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_users_tenant_active_owners
  ON users (tenant_id)
  WHERE deleted_at IS NULL AND is_active = true AND role = 'owner';

-- ── 3. user_audit_log ───────────────────────────────────────────────────────
-- Mirrors the credit_audit_events convention: no FKs on actor_id / target_id
-- so audit history survives soft-deletion. Append-only by convention
-- (UPDATE / DELETE are never issued against this table).

CREATE TABLE IF NOT EXISTS user_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  actor_id   uuid NULL,
  target_id  uuid NOT NULL,
  action     text NOT NULL CHECK (action IN (
    'deactivated',
    'reactivated',
    'deleted',
    'role_changed',
    'owner_transferred'
  )),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_audit_log IS
  'Append-only audit for user lifecycle events (deactivate / reactivate / '
  'delete / role change / owner transfer). actor_id and target_id are '
  'intentionally not foreign keys so the audit trail survives soft-deletion '
  'of either party. Mirrors the credit_audit_events pattern.';

CREATE INDEX IF NOT EXISTS idx_user_audit_log_tenant_target_created
  ON user_audit_log (tenant_id, target_id, created_at DESC);

-- ── 4. Last-owner invariant trigger ────────────────────────────────────────
-- Service layer (UsersService.assertNotLastOwner) fails-fast with a clean
-- 400. This trigger is the safety net: ANY update that would leave a tenant
-- with zero active owners is rejected at the DB layer with the same error
-- prefix (`cannot_remove_last_owner:`) so downstream code can match on it.
--
-- Guards UPDATE only. Hard DELETE is not expected on the users table;
-- soft-delete via UPDATE deleted_at is the canonical path. Any future hard
-- DELETE would need a corresponding BEFORE DELETE trigger.

CREATE OR REPLACE FUNCTION users_tenant_requires_active_owner_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  remaining_active_owners INT;
BEGIN
  -- Fast-exit: only enforce when the change could reduce the active-owner
  -- count. If OLD wasn't an active owner, nothing to check.
  IF NOT (
       OLD.role = 'owner'
       AND OLD.is_active = true
       AND OLD.deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Only enforce if the update is actually removing this row's owner
  -- status OR activeness OR non-deleted state.
  IF NEW.role = 'owner'
     AND NEW.is_active = true
     AND NEW.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO remaining_active_owners
    FROM users
   WHERE tenant_id = OLD.tenant_id
     AND id <> OLD.id
     AND role = 'owner'
     AND is_active = true
     AND deleted_at IS NULL;

  IF remaining_active_owners = 0 THEN
    RAISE EXCEPTION
      'cannot_remove_last_owner: Tenant must have at least one active owner'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION users_tenant_requires_active_owner_fn() IS
  'Defense-in-depth for the last-owner invariant. Mirrors '
  'UsersService.assertNotLastOwner(); service layer fails fast with a clean '
  '400, this trigger catches any bypass path (direct SQL, console scripts) '
  'and raises the same error prefix. Guards UPDATE only — hard DELETE is not '
  'expected on users; soft-delete via UPDATE deleted_at is the canonical path. '
  'Any future hard DELETE would need a corresponding BEFORE DELETE trigger.';

DROP TRIGGER IF EXISTS users_tenant_requires_active_owner ON users;

CREATE TRIGGER users_tenant_requires_active_owner
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_tenant_requires_active_owner_fn();

COMMIT;

-- ── Post-apply verification (run each; expect one row per query) ───────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'deleted_at';
--
-- SELECT * FROM pg_trigger WHERE tgname = 'users_tenant_requires_active_owner';
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name = 'user_audit_log';

-- ── Rollback ───────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TRIGGER IF EXISTS users_tenant_requires_active_owner ON users;
-- DROP FUNCTION IF EXISTS users_tenant_requires_active_owner_fn();
-- DROP INDEX IF EXISTS idx_user_audit_log_tenant_target_created;
-- DROP TABLE IF EXISTS user_audit_log;
-- DROP INDEX IF EXISTS idx_users_tenant_active_owners;
-- DROP INDEX IF EXISTS idx_users_tenant_active_nondeleted;
-- ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
-- COMMIT;
