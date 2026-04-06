-- ROLLBACK: Remove RLS from Top 5 Tables
-- Run in Supabase SQL editor if RLS causes issues

-- Customers
DROP POLICY IF EXISTS "tenant_isolation_select" ON customers;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON customers;
DROP POLICY IF EXISTS "tenant_isolation_update" ON customers;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON customers;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;

-- Invoices
DROP POLICY IF EXISTS "tenant_isolation_select" ON invoices;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON invoices;
DROP POLICY IF EXISTS "tenant_isolation_update" ON invoices;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON invoices;
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;

-- Jobs
DROP POLICY IF EXISTS "tenant_isolation_select" ON jobs;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON jobs;
DROP POLICY IF EXISTS "tenant_isolation_update" ON jobs;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON jobs;
ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;

-- Payments
DROP POLICY IF EXISTS "tenant_isolation_select" ON payments;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON payments;
DROP POLICY IF EXISTS "tenant_isolation_update" ON payments;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON payments;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

-- Pricing Rules
DROP POLICY IF EXISTS "tenant_isolation_select" ON pricing_rules;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON pricing_rules;
DROP POLICY IF EXISTS "tenant_isolation_update" ON pricing_rules;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON pricing_rules;
ALTER TABLE pricing_rules DISABLE ROW LEVEL SECURITY;
