# ServiceOS — Standing Rules

This file is loaded at every Claude Code session start. These rules are non-negotiable.

## Architectural standing rules

1. **NO REGISTRY BYPASS** — All user-facing labels (sidebar, headers, breadcrumbs, tooltips, Help Center, category names) must come from `getFeatureLabel(featureId)` in `web/src/lib/feature-registry.ts`. New features MUST have a registry entry. "If visible to the user, it comes from the registry."
2. **MULTI-TENANT SAFE ONLY** — `tenant_id` from JWT only (`req.user.tenant_id`), never from client payload. `TenantGuard` on all endpoints. No cross-tenant data access.
3. **BACKEND IS TRUTH** — No frontend-only logic for business rules. Backend is authoritative.
4. **DERIVED STATE** — No duplicating state that can be derived.
5. **SSOT** — Single source of truth. No parallel implementations.
6. **SEPARATED CONCERNS** — Controllers route. Services own business logic.
7. **ADDITIVE ONLY** — No breaking changes to existing contracts without explicit approval.
8. **SCOPE** — Standard flows (Customers page, etc.) must remain untouched when adding new behavior.
9. **NO MAGIC** — No silent side effects or implicit behaviors.
10. **NO HARDCODED TENANT VALUES** — No magic IDs, prices, or durations baked into code.

## Invoice rules (inviolable)

1. `reconcileBalance()` is the ONLY way to set `invoice_status` / `amount_paid` / `balance_due`. Never set directly.
2. All invoices `'open'` — NEVER `'draft'`.
3. No tax on customer invoices.
4. Distance surcharge folded into rental line item (single line, internal snapshot preserved for reporting).
5. Dump ticket edits: `syncJobCost` → line items → invoice total → `reconcileBalance`.
6. Dispatch gated behind payment via LEFT JOIN on `task_chain_links + invoices`. Manual/legacy jobs (no chain) still appear.

## Security standing rules

- Every prompt needs a `## Security requirements` section: tenant + auth + role + abuse for new endpoints; rate-limit + token + enumeration + PII for public flows.
- User-facing errors explain what happened + fix-when-knowable. Never raw 500. Translate DB/validation failures.
- `tenantId` always from authenticated JWT (`req.user.tenant_id`), never from request body.

## Deployment rules

- **Web:** auto-deploys on `git push`. **NEVER `vercel --prod` from `web/`.**
- **API:** `git push && cd api && vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)`. The `--build-env` flag is REQUIRED for Sentry release pinning.
- **DB migrations:** Supabase SQL editor BEFORE API deploy. Always.
- TypeORM `synchronize: true` is on in production. New NOT NULL columns require manual `ALTER TABLE` in Supabase BEFORE API deploy or cold start crashes.
- Always confirm Claude Code is in `~/serviceos` before running ServiceOS prompts. Never work in `~/Desktop/rentthis` for ServiceOS features.

## Repo discipline

- Repo: `~/serviceos` (NestJS API + Next.js frontend monorepo)
- DO NOT work in `~/Desktop/rentthis` (RentThis marketplace — separate repo)
- Production tenant: Rent This Dumpster (`822481be`)
- Supabase project: `voczrzbdukgdrirmlgfw`
- Vercel team: `team_Pl6PH3JCzmLiKMrUTTCadwI7`
- Vercel API project: `prj_F5igRgwn3kAEzlD5f7ZxKM0xI5XP`
- Vercel Web project: `prj_IGnjm6LEWY2Zbsw7mYRdBjoBQm3B`

## Workflow

- Audit before implement. Use Plan Mode (Shift+Tab) for anything touching billing, lifecycle, or dispatch.
- Use Opus for planning, Sonnet for execution: `/model opus` → plan mode → approve → `/model sonnet` → execute.
- Specialized review: invoke `@serviceos-qa-auditor`, `@serviceos-billing-guardian`, `@serviceos-lifecycle-auditor` after implementation.
- NEVER auto-commit. NEVER auto-push.

## Followups (infrastructure — small, when you have a quiet 10 minutes)

- Install gh CLI (`brew install gh && gh auth login`) so Claude Code can open PRs directly via `gh pr create` instead of falling back to the browser. Avoids the manual title/body copy-paste step on PRs #10 and #11.
- Add `gh pr create` step to PR-B-style implementation prompts once gh is installed — replaces the "open this URL in your browser" final step.
