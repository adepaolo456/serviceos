-- RLS Defense-in-Depth for Top 5 Tenant-Scoped Tables
-- Run in Supabase SQL editor
--
-- IMPORTANT: The NestJS API connects as postgres superuser, which BYPASSES RLS.
-- These policies protect against:
--   1. Direct Supabase REST API access (if anon key leaks)
--   2. Supabase dashboard misuse
--   3. Future client-side Supabase integrations
--
-- Application-level tenant filtering in NestJS remains the primary protection.

-- ============================================================
-- 1. CUSTOMERS
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON customers
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON customers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON customers
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON customers
  FOR DELETE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 2. INVOICES
-- ============================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON invoices
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON invoices
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON invoices
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON invoices
  FOR DELETE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 3. JOBS
-- ============================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON jobs
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON jobs
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON jobs
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON jobs
  FOR DELETE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 4. PAYMENTS
-- ============================================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON payments
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON payments
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON payments
  FOR DELETE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- 5. PRICING_RULES
-- ============================================================
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON pricing_rules
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON pricing_rules
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON pricing_rules
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_delete" ON pricing_rules
  FOR DELETE TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- VERIFICATION QUERIES (run after applying)
-- ============================================================
-- Check RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('customers', 'invoices', 'jobs', 'payments', 'pricing_rules');
--
-- Check policies exist:
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
-- AND tablename IN ('customers', 'invoices', 'jobs', 'payments', 'pricing_rules');
