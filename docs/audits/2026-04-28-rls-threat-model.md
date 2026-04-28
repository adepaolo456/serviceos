# DECISION — RLS threat model for ServiceOS

**Status:** Decided. Option 1 selected.
**Driver:** verify-rls-expansion-state audit (2026-04-28)
**Decided on:** 2026-04-28

---

## Context (audit summary)

- **56/56** public tables have `relrowsecurity = true`. Every table is RLS-enabled.
- **6 tables** have policies (`customers`, `invoices`, `jobs`, `payments`, `pricing_rules`, `quotes`). 50 are default-deny for any non-bypassing role.
- **The API path bypasses RLS by design.** `DATABASE_URL` points at the `postgres` role, which has `bypassRLS = true`. The original migration file (`api/migrations/005_rls_top5_tables.sql:4`) documents this explicitly: *"The NestJS API connects as postgres superuser, which BYPASSES RLS. These policies protect against (1) leaked anon/service_role keys, (2) Supabase dashboard misuse, (3) future client-side Supabase integrations. Application-level tenant filtering in NestJS remains the primary protection."*
- **Zero per-request claims injection exists.** No `set_config` / `SET LOCAL` / `request.jwt.claims` calls anywhere in `api/src/`. Even if RLS were enforced, the canonical `auth.jwt() ->> 'tenant_id'` policies would have nothing to read.
- **No `TenantGuard` exists.** Tenant isolation is two layers: per-query `tenant_id` filtering (~2,646 sites) plus the CLS-based tenant-context interceptor.
- **Quotes policy diverges** from the canonical pattern in three ways at once (different mechanism, different role target, single ALL policy instead of split-by-cmd) — likely intentional for portal token access, but undocumented at the time of this decision.
- **9 tables** still had `tenant_id` typed as `varchar` instead of `uuid` at the time of decision. *Closed by migration 009; see "Post-decision actions" below.*

The current state is internally coherent if and only if the threat model is *defense-in-depth against leaked Supabase keys / dashboard misuse / future PostgREST surface*. It's broken if and only if the threat model is *primary tenant-isolation control on the API path*. The two paths require very different work.

---

## The fork

### Option 1 — RLS as defense-in-depth only

**Premise:** the API path is, and remains, the primary tenant-isolation control via app-layer enforcement. RLS exists to lock down secondary attack surfaces (Supabase REST/dashboard/realtime) so they're safe even with leaked credentials.

**What stays the same:**
- API continues to connect as `postgres` via `DATABASE_URL`.
- 2,646 per-query `tenant_id` filter sites remain primary control.
- CLS tenant-context interceptor remains the per-request tenant scope mechanism.
- 50 default-deny tables stay default-deny — that's the *correct* posture for tables that should never be reachable via PostgREST or the Supabase dashboard.
- 6 policied tables retain their policies (defending against leaked anon key + future PostgREST-based features).

**What changes (small hygiene):**
1. **Threat model doc.** One markdown file in `docs/audits/2026-04-28-rls-threat-model.md` recording the decision. Prevents this question from being re-litigated and prevents a future contributor from running a phantom "RLS expansion sprint." (~1 hour)
2. **Quotes policy decision.** Either (a) document the divergence as intentional with a SQL comment explaining portal-token access has no Supabase JWT, or (b) converge to canonical (requires varchar→uuid widening on `quotes.tenant_id` first). Recommend (a). (~1 hour)
3. **Widen 9 `varchar tenant_id` columns to `uuid`.** Closes the open class-A regression audit; makes a single canonical policy shape possible across the schema; prevents type-coercion bugs of the same family as the `uuid: "all"` and `uuid = text` arcs we just closed. Bounded data migration with rollback. (~half-day)
4. **Optional: `FORCE ROW LEVEL SECURITY`** on the 6 policied tables. Closes the table-owner bypass (a `postgres` role acting as table owner can still skip RLS without `FORCE`). Does *not* close the `bypassRLS = true` gap on the API path — that's by design under Option 1. Marginal value; defer unless a specific reason surfaces. (~1 hour if pursued)

**Estimated total work:** ~1 day.
**Risk:** low. Each change is localized, reversible, no architectural shift.
**What this defends against:** leaked anon/service_role keys, Supabase dashboard misuse, future client-side Supabase usage, type-coercion bugs in tenant_id columns.
**What this does NOT defend against:** a code change that forgets the per-query `tenant_id` filter. That class of bug is caught by code review, integration tests, and the CLS interceptor — not by RLS, because RLS isn't running for the API path.

---

### Option 2 — RLS as primary tenant-isolation control on the API path

**Premise:** the app layer is fallible. RLS should enforce tenant isolation at the database layer regardless of what the application code does, so a missing `tenant_id` filter in any future query is caught by Postgres rejecting the row, not by the bug shipping.

**What changes (significant):**
1. **Switch `DATABASE_URL` off the `postgres` role.** Create a custom non-bypassing application role with explicit `GRANT`s on every table the API touches. Audit every migration, seed script, and cron path that may currently rely on superuser-ish privileges (e.g., `CREATE EXTENSION`, `ALTER SYSTEM`, ownership-only operations). Likely needs a separate "admin" connection for migrations and a second role for the API runtime.
2. **Per-request claims injection.** Add a NestJS interceptor that, after `JwtAuthGuard` resolves the user, executes `SELECT set_config('request.jwt.claims', $1, true)` (or `set_config('app.tenant_id', $tid, true)`) on the request-scoped TypeORM connection before any query runs. Adds a SQL roundtrip per request (or requires connection-pinning per request, which TypeORM doesn't do natively).
3. **Reconcile the `quotes` policy.** The portal-token access path doesn't have a Supabase JWT — needs a separate policy or a different GUC mechanism for that flow.
4. **Add canonical-pattern policies to the 50 default-deny tables.** Each tenant-scoped table needs SELECT/INSERT/UPDATE/DELETE policies. Junction tables (`invoice_line_items`, `dump_location_rates`, `task_chain_links`, etc.) need decisions: own policy vs inherit-via-FK. Lookup tables (`subscription_plans`) need explicit "this is global, allow all" or "GRANT to anon" decisions.
5. **Widen the 9 `varchar tenant_id` columns to `uuid`** (same as Option 1 but mandatory here, not optional).
6. **Handle non-tenant-scoped paths.** Cron jobs (`/automation/cron/*`), public flows (signup, password reset, OAuth callback), platform-admin endpoints — none of these have a tenant claim. They need either a service-role bypass connection or explicit policy carve-outs.

**Estimated total work:** 2–3 weeks.
**Risk:** high. Connection role switch can break production if any code path relies on superuser-only operations. Per-request claims injection adds measurable latency (one SQL call per request, or non-trivial connection-pinning logic). Each of the 50 policy migrations is a chance to write a wrong predicate. Cron paths, OAuth flows, and platform admin tooling all need separate handling.
**What this defends against:** everything Option 1 defends against, *plus* a future code change that forgets a `tenant_id` filter (caught by Postgres "permission denied" instead of shipped as a cross-tenant leak).
**What this does NOT defend against:** a compromised API server (attacker has the application role credential and can construct any JWT it wants), an injection bug in JWT decoding, or a logic bug in the claims-injection interceptor itself.

---

## Decision factors

| Factor | Option 1 | Option 2 |
|---|---|---|
| Time cost | ~1 day | 2–3 weeks |
| Risk to prod | Low | High (connection role swap, per-request SQL overhead) |
| Defends leaked anon/service_role key | Yes | Yes |
| Defends dashboard misuse | Yes | Yes |
| Defends future PostgREST-based features | Yes | Yes |
| Defends "forgot tenant_id filter" bug | No (code review catches) | Yes (DB rejects row) |
| Performance impact | None | +1 SQL call/request or connection-pinning logic |
| Operational complexity | None | New role, new GRANTs, claims interceptor, cron carve-outs |
| Reverses if wrong | Trivially | Hard (50+ migrations, role swap) |

---

## Recommendation: **Option 1**

Three reasons:

1. **The threat Option 2 uniquely defends against — a missing `tenant_id` filter — is better caught by code review, integration tests, and lint rules than by RLS.** RLS surfaces this class of bug as `permission denied for table X`, with no context for which tenant or row caused the failure. A test fixture that runs every API endpoint as two different tenants and asserts row counts catches the same bug with a meaningful error and zero runtime cost. ServiceOS already has 2,646 enforced filter sites and the CLS interceptor — the real risk surface for "forgotten filter" is small and shrinking, not growing.

2. **The 2,646 query-filter sites + CLS interceptor are the primary control, and they're thick.** Option 2 layers RLS on top doing essentially the same check the app already does, at a different layer, with overhead. If the app layer were thin or unreliable, RLS-as-primary would be valuable defense-in-depth. The app layer here is neither.

3. **Cost vs benefit favors shipping features.** 2–3 weeks of architectural-risk work to defend against a threat that's already mitigated, in exchange for a marginal security improvement. The same 2–3 weeks spent on Phase 2 (e-sign, permits, accounting, GPS) generates revenue. ServiceOS is launch-ready with one tenant; the blast radius of the un-defended threat is small today, and Phase 2 work expands the platform's value-per-tenant much more than RLS-as-primary expands its security posture.

**Caveat that would flip this:** if ServiceOS adds a feature where the web client connects to Postgres directly — Supabase Realtime subscriptions, a customer-facing PostgREST surface, or any flow where a non-platform-controlled credential can reach the database — Option 2 becomes mandatory. Track that. The original migration's L4 comment names this exact case as the reason the policies exist at all.

---

## Decision

- [x] **Option 1** — defense-in-depth only. Proceed with the four hygiene items.
- [ ] **Option 2** — primary control on API path. Proceed with the major-architecture sprint.

**Decided by:** Anthony DePaolo
**Date:** 2026-04-28
**Justification:** Option 2 defends against a threat (missing `tenant_id` filter on the API path) that is already mitigated by 2,646 enforced filter sites, the CLS interceptor, and code review. The 2–3 week cost of switching connection roles, injecting claims per request, and writing 50 new policies trades architectural risk for a marginal security improvement, while the same time spent on Phase 2 (e-sign, permits, accounting, GPS) is revenue-generating. RLS remains valuable as defense-in-depth for the secondary surfaces (leaked anon/service_role keys, dashboard misuse, hypothetical PostgREST/Realtime usage) — those are the threats it actually defends against given the current architecture, and they're the threats the original migration `005_rls_top5_tables.sql:4` already named.

---

## Post-decision actions

Items 1–3 from the Option 1 hygiene block above all shipped on 2026-04-28:

1. **This document.** `docs/audits/2026-04-28-rls-threat-model.md`. Created in the same PR as the quotes policy comment (see item 2). The dangling reference at `api/migrations/009_widen_tenant_id_to_uuid_9_tables.sql:13` resolves correctly once this file lands.

2. **Quotes policy comment.** `api/migrations/010_comment_quotes_rls_policy.sql` adds a `COMMENT ON POLICY quotes_tenant_isolation ON quotes IS '...'` recording the divergence rationale (portal/token-style flows have no Supabase JWT) plus the framing that both forms fail closed for non-bypassing roles. Recommended option (a) from the Option 1 hygiene block; option (b) — convergence to canonical pattern — is explicitly not planned, per the comment text.

3. **9-table `varchar → uuid` widening.** Migration 009 (commits `6283a47` for SQL files, `63bc973` for entity decoration alignment) shipped, was deployed to production, cold-start probe + browser smoke green. Tables affected: `ai_suggestion_log`, `delivery_zones`, `dump_tickets`, `pricing_templates`, `quotes`, `tenant_settings`, `tenant_setup_checklist`, `time_entries`, `yards`. Quotes RLS policy was DROP'd and recreated identically as part of 009 to satisfy Postgres' dependency tracking.

4. **`FORCE ROW LEVEL SECURITY` on the 6 policied tables.** *Deferred.* Marginal value (closes table-owner bypass without closing the by-design `bypassRLS=true` gap on the API path). No specific reason has surfaced to warrant the work.

## Items deliberately not in scope of this decision

- Switching `DATABASE_URL` off the `postgres` role.
- Adding per-request claims injection.
- Adding policies to the 50 default-deny tables.
- Reformulating the quotes policy expression.

If any of those become necessary (per the "caveat that would flip this" note above), this decision is re-opened, not amended.

## Backlog tracked separately

- **Quotes policy expression drift** — pre-existing, predates this decision. The original `migrations/alter-quotes-add-token-and-fields.sql:45` created the policy as `(tenant_id = current_setting('app.tenant_id')::uuid)`; the live policy evaluates as `((tenant_id)::text = current_setting('app.tenant_id'::text))`. No tracked migration accounts for the change. Likely a one-time edit via the Supabase dashboard. Both forms fail closed for non-bypassing roles, so the difference is academic under Option 1, but the provenance gap is a real backlog item.
