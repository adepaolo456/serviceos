-- ─────────────────────────────────────────────────────────────────────────────
-- SMS Number Release Request workflow (V1)
--
-- Tenant admins request removal of their assigned SMS number; ServiceOS admin
-- reviews and triggers actual Twilio release. Tenant assignment in
-- tenant_settings.sms_phone_number is only cleared after successful provider
-- release.
--
-- Idempotent / additive only. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sms_number_release_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID         NOT NULL,
  sms_phone_number        VARCHAR(20)  NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'pending',
  requested_by_user_id    UUID         NOT NULL,
  requested_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_by_user_id     UUID,
  reviewed_at             TIMESTAMPTZ,
  review_notes            TEXT,
  released_at             TIMESTAMPTZ,
  provider_phone_sid      VARCHAR(64),
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT sms_number_release_requests_status_check
    CHECK (status IN ('pending', 'rejected', 'released', 'failed'))
);

-- Admin list ordering / status filter
CREATE INDEX IF NOT EXISTS idx_sms_release_status_created
  ON sms_number_release_requests (status, created_at DESC);

-- Tenant lookup of own requests
CREATE INDEX IF NOT EXISTS idx_sms_release_tenant_created
  ON sms_number_release_requests (tenant_id, created_at DESC);

-- Concurrency safeguard: at most ONE pending request per tenant + number.
-- Enforced atomically by Postgres so two simultaneous tenant requests cannot
-- both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_release_pending_per_number
  ON sms_number_release_requests (tenant_id, sms_phone_number)
  WHERE status = 'pending';
