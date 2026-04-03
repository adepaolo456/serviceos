-- ============================================================================
-- Pricing Engine V2 Migration
-- Adds: config versioning, exchange context, commercial/residential policies,
--        tenant fees, pricing snapshots, recalculation tracking, multi-yard
-- ============================================================================

-- ── Step 2: Pricing config versioning ────────────────────────────────────────

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS version_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES pricing_rules(id),
  ADD COLUMN IF NOT EXISTS created_by UUID;

-- Enforce only one active version per tenant per asset_subtype
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_tenant_subtype
  ON pricing_rules(tenant_id, asset_subtype) WHERE is_active = true;

-- ── Step 6: Commercial vs residential rental policies ────────────────────────

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS residential_included_days INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS commercial_included_days INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS residential_extra_day_rate DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS commercial_extra_day_rate DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS commercial_unlimited_days BOOLEAN DEFAULT false;

-- ── Step 7: Tenant fees ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fee_key VARCHAR(50) NOT NULL,
  label VARCHAR(100) NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  applies_to VARCHAR(50) DEFAULT 'all',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, fee_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_fees_tenant ON tenant_fees(tenant_id);

-- ── Step 8: Pricing snapshots ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  request_inputs JSONB NOT NULL,
  pricing_outputs JSONB NOT NULL,
  pricing_config_version_id UUID,
  engine_version VARCHAR(20) DEFAULT 'v2',
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  locked BOOLEAN DEFAULT true,
  recalculated_from UUID REFERENCES pricing_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_tenant ON pricing_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_job ON pricing_snapshots(job_id);

-- ── Step 4: Job pricing snapshot tracking ────────────────────────────────────

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pricing_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pricing_config_version_id UUID,
  ADD COLUMN IF NOT EXISTS pricing_snapshot_id UUID REFERENCES pricing_snapshots(id);

-- ── Step 5 (jobs update flow): Job pricing audit ─────────────────────────────

CREATE TABLE IF NOT EXISTS job_pricing_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  previous_pricing_snapshot_id UUID REFERENCES pricing_snapshots(id),
  new_pricing_snapshot_id UUID REFERENCES pricing_snapshots(id),
  recalculation_reasons JSONB NOT NULL,
  triggered_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_pricing_audit_tenant ON job_pricing_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_pricing_audit_job ON job_pricing_audit(job_id);

-- ============================================================================
-- END MIGRATION
-- ============================================================================
