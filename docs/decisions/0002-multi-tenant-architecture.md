# 0002 — Multi-tenant architecture (JWT-derived tenant_id, app-layer filtering, RLS defense-in-depth)

**Status:** accepted
**Date:** 2026-04-30

## Context

ServiceOS is a multi-tenant SaaS. Every customer (Rent This Dumpster, future tenants) has their own jobs, invoices, customers, drivers, pricing, branding, etc. Tenant data isolation is foundational — a single cross-tenant data leak is a trust-destroying event that ends the company.

The choice was: how do we isolate tenant data? At which layer? With what enforcement posture?

## Options considered

### Option A: Database-per-tenant
Each tenant gets its own PostgreSQL database. Application connects to the right DB based on subdomain or JWT claim.

Pros: complete isolation, impossible to leak data across tenants at the query level, per-tenant backup/restore is trivial
Cons: enormous operational overhead (migrations across N DBs, connection pooling per DB, expensive at scale), can't easily query across tenants for ops/admin/analytics, complex onboarding (provision a new DB per tenant)

### Option B: Schema-per-tenant
Single PostgreSQL database, separate schema per tenant. Application sets `search_path` based on JWT.

Pros: better than Option A for migrations, still strong isolation
Cons: schemas multiply with tenant count (every new tenant adds a schema), migrations still N-times work, search_path is easy to mess up

### Option C: Shared schema with tenant_id column
Single database, single schema, every tenant-scoped table has a `tenant_id` column. Application enforces filtering.

Pros: simple, scales easily, easy migrations, easy cross-tenant ops queries
Cons: relies entirely on application-layer enforcement; a missing WHERE clause is a data leak

### Option D: Shared schema + RLS as primary enforcement
Same as Option C, but Row Level Security policies in PostgreSQL enforce tenant isolation. Application sets `app.tenant_id` session variable or uses JWT-claim-aware policies.

Pros: defense in depth — even if app forgets a WHERE clause, DB rejects the row
Cons: RLS adds query complexity, performance considerations (policy must be evaluated per row), requires careful policy authoring, can be bypassed by superuser connections

### Option E: Shared schema + app-layer enforcement primary, RLS defense-in-depth
Application enforces tenant isolation in code: every authenticated request resolves `tenant_id` from JWT/session, and every service-layer query filters by `tenant_id`. CLS/context mechanisms propagate tenant context across async boundaries. RLS is enabled on tables but the API connects through a bypassing role for performance and cross-tenant ops queries.

Pros: simple application code, fast queries, easy to reason about, RLS catches mistakes for non-API access paths (direct Supabase, PostgREST, future analytics tools)
Cons: depends on every service-layer query correctly filtering by `tenant_id` (one missing WHERE clause is a leak); RLS posture must be documented so future contributors don't assume RLS is primary for the API path

## Decision

**Option E — shared schema with app-layer enforcement primary, RLS as defense-in-depth.**

Specifically:

- Every tenant-scoped table has a `tenant_id` column (UUID).
- `tenant_id` is **always derived from authenticated context** at the application layer — JWT claims and/or session state. Never accepted from request body. Never inferred from URL path. Always sourced from the authenticated principal.
- **Tenant isolation is enforced primarily in application code:** authenticated requests resolve tenant context from JWT/session state, and service-layer queries filter by `tenant_id`. Some flows also use CLS/context mechanisms to propagate tenant context across async boundaries.
- **There is currently no `TenantGuard` class.** Do not assume guard-based enforcement exists. If a future ADR introduces one, this ADR is superseded for that aspect.
- Every service-layer query that touches tenant-scoped data MUST filter by `tenant_id` from the authenticated context.
- **RLS is enabled on 56/56 public tables.** Six tables have explicit policies; the remaining RLS-enabled tables are default-deny for non-bypassing roles. The NestJS API currently connects through a bypassing/superuser-equivalent role, so RLS is **defense-in-depth for direct Supabase / PostgREST / client paths**, not the primary runtime enforcement for the API.
- Tenant identity is encoded in subdomain for the multi-tenant frontend (e.g., `rent-this-dumpster.rentthisapp.com`). Subdomain → tenant lookup happens in middleware.

Rationale:

1. **Operational simplicity.** Single DB, single schema, no per-tenant provisioning. Adding a new tenant is one INSERT.
2. **Cross-tenant ops queries are easy.** Admin dashboards, analytics, demo-customer exclusion all work without per-tenant connection juggling.
3. **App-layer enforcement is the right primary line.** It's where business logic lives, it's testable, it's reviewable. Every service file is auditable for proper tenant filtering.
4. **RLS is defense in depth for non-API paths.** Direct Supabase access (PostgREST, direct client connections, future analytics tools) hits RLS as the enforcement layer. The API path bypasses RLS because the bypassing role is required for cross-tenant ops queries (analytics, admin tooling, demo-customer exclusion). Whether to flip the API to a non-bypassing role is an open follow-up tracked in `docs/arc-state.md`.

## Consequences

**Locked in:**
- All future tables that hold tenant data MUST include a `tenant_id` column with foreign key to `tenants.id`.
- All tenant-scoped controller/service paths MUST derive `tenant_id` from authenticated context and apply `tenant_id` filtering in service-layer queries. Public/admin-only exceptions must be explicit and audited.
- All service-layer queries that touch tenant-scoped data MUST filter by `tenant_id` from authenticated context.
- Subdomain encoding for tenant identity (no path-based tenant prefix like `/t/<slug>/...`).
- RLS policies live alongside table migrations and are enabled on all public tables.

**Left open:**
- RLS posture review: future ADR may flip RLS from defense-in-depth to primary enforcement (would require API to connect as a non-superuser role and explicit RLS policies for every table).
- Tenant data export: not built yet, will need to respect tenant isolation when designed.
- Cross-tenant marketplace listings (Phase 3 RentThis): when implemented, will need explicit cross-tenant query patterns audited.

**Reversal cost:**
- Switching to Option A or B (DB-per-tenant or schema-per-tenant) would be a 4-6 week project — re-architecture of every connection, migration, and query. We would only consider this if a customer demanded it for compliance reasons (HIPAA, regulated industries) AND was willing to pay enterprise-tier pricing for the operational overhead.
- Switching to Option D (RLS primary) is a doable migration — flip the connection role to a non-superuser, audit every RLS policy. Estimated 2-3 weeks. Would do this if we want to harden against application-layer bugs at the cost of query complexity.

## Related

- CLAUDE.md — operational rules: "MULTI-TENANT SAFE — tenant_id from JWT only, never from client payload"
- ADR 0001 — monorepo structure (app-layer tenant filtering and shared tenant-context patterns live in `api/`, shared via TypeScript imports)
- `docs/audits/` — every audit doc verifies tenant isolation in the changed code path
- Open follow-up in `docs/arc-state.md` — RLS threat-model decision doc (defense-in-depth-only vs primary API enforcement)
