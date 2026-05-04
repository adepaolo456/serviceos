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

### Lifecycle-semantics arc — partial-completion enum

Following PR #15 (autoCloseChainIfTerminal expansion audit, STRICT verdict), partial-completion rental chains (delivery completed + pickup cancelled) intentionally remain `status='active'` until a future arc lands a `'partially_completed'` enum value and updates these consumers:

- `api/src/modules/reporting/reporting.service.ts:1314,1490` — completed_rentals KPI + average_rental_duration denominator + per-period trend buckets
- `web/src/app/(dashboard)/customers/[id]/page.tsx:661-662` — chain-status label short-circuit
- `web/src/app/(dashboard)/jobs/page.tsx:586-588` — same short-circuit pattern
- `web/src/app/(dashboard)/rentals/[id]/page.tsx:392` — STATUS_LABELS map
- `web/src/components/rental-chain-timeline.tsx:75` — raw chain.status render
- `api/src/modules/assets/assets.service.ts:368` — retirement guard re-audit
- DB enum migration via Supabase `ALTER TYPE` BEFORE API deploy (TypeORM `synchronize: true` in prod requires manual ALTER first)

PR #14's one-time backfill of 6 ghost chains to `'completed'` is documented as a backfill, NOT a precedent for new code behavior. New code must never write `'completed'` to a chain with cancellations until the arc lands.

Reference: `docs/audits/2026-04-30-autoclose-expansion-audit.md`

### Deferred — `reconcileBalance()` bypass audit + fix arc

PR #19 audit (`docs/audits/2026-04-30-reconcilebalance-bypass-audit.md`) verified the 4 bypass sites at their post-PR #17 line numbers, surfaced 2 critical findings beyond the original PR-C1b notes, and locked a 3-stage PR shape via billing-guardian sign-off.

**Status:**
- ✅ PR-C1c-pre — `reconcileBalance()` math fix at `invoice.service.ts:987` + `isFullyRefunded()` helper + tests (PR #20)
- ✅ PR-C1c — Sites 1 + 2 sync bypass replacements (`chargeInvoice` → `reconcileBalance`; `refundInvoice` → `isFullyRefunded` + `voided_at` stamp + `reconcileBalance`) (this PR)
- ⏳ PR-C2 — Sites 3 + 4 webhook bypass replacements + new `stripe_events` event-id dedup table

**Locked blockers (from PR #19 audit):**
- C-1: refund-subtraction is the intended `totalPaid` semantic
- C-2: refund flow stamps `voided_at` when `refundedAmount === total` (matches `voidInvoice` precedent)
- C-3: Site 4 payment-row dedup defers to PR-C2 alongside event-id dedup

**Out of scope (separate hardening, deferred):**
- PR-C1d — pessimistic invoice-row lock for `chargeInvoice` / `refundInvoice` controller routes

PR-C1c-pre changes the canonical `totalPaid` semantic for ALL existing `reconcileBalance()` callers (`voidInvoice`, `applyPayment`, `recalculateTotals`, `createInternalInvoice`). Per audit, blast radius is bounded and corrective — historical incorrect totals heal on the next reconcile call.

### Deferred — `subscriptions.service.ts` idempotency + SSoT arc

Status: LIVE customer-facing billing code (verified via Phase 0a grep on 2026-04-30).

4 Stripe writes need classification + idempotency:
- `api/src/modules/subscriptions/subscriptions.service.ts:72` (`customers.create`)
- `api/src/modules/subscriptions/subscriptions.service.ts:84` (`prices.create`)
- `api/src/modules/subscriptions/subscriptions.service.ts:95` (`checkout.sessions.create`)
- `api/src/modules/subscriptions/subscriptions.service.ts:121` (`billingPortal.sessions.create`)

5 active HTTP routes:
- `GET /billing/subscription`
- `POST /billing/select-plan`
- `POST /billing/create-checkout-session`
- `GET /billing/portal`
- `POST /billing/webhook`

SSoT concern: `SubscriptionsService` (`/billing/*`) and `StripeService.subscribe` (`/stripe/*`) are parallel implementations of subscription flows. Decide which is canonical.

Required next step: dedicated billing-guardian-led audit (PR-C1b-2 likely). Audit must (a) classify each site P0/P1/P2, (b) decide whether `SubscriptionsService` should be deprecated in favor of `StripeService.subscribe`, (c) propose key shapes per site only after classification, (d) propose webhook handling ownership at `/billing/webhook` (separate from the `/stripe/webhook` dedup that's PR-C2's scope).

Tracked: 2026-04-30 from PR-C1b-1 Phase 0a verdict.

## How to think (every task)

1. **Think before coding.** Read the relevant files. State your plan in 2–3 sentences. If anything is ambiguous, ASK — never assume.
2. **Simplicity first.** Smallest change that solves the problem. No new abstractions unless required. No "while I'm in here" refactors.
3. **Surgical edits.** If 3 lines fix it, change 3 lines. Never rewrite a file when an edit will do. Never reformat code you're not touching.
4. **Goal-driven.** Build only what was asked. If you spot something worth doing, mention it — don't do it.

## Read the relevant skill before non-trivial work

- Backend, frontend, architecture → `serviceos-engineer`
- Invoices, credits, payments, cancellations → `serviceos-billing-guardian`
- Jobs, rentals, dispatch, exchanges, lifecycle → `serviceos-lifecycle-auditor`
- Reviewing diffs before deploy → `serviceos-qa-auditor`

## Multi-vertical scoping

Waste/dumpster features (dump slips, weight tickets, tonnage pricing, dump locations) must check `business_type` on the tenant. Never hardcode as universal logic. Same rule applies to any future vertical-specific feature.

## No Docket copying

Docket and other competitors are inspiration only. All code, design tokens, and copy must be original. Studying competitor flows is fine; reproducing patterns verbatim is not.

## Brand split

- **Internal** (code, repo, DB schemas, Vercel project names): `serviceos`
- **External** (customer-facing strings, domains, API key prefixes): `rentthisapp`, `rta_live_`
- Do NOT rename internal references until post-launch.

## Design system

White cards (`#FFF`) on dark frame (`#000`), 20px border-radius, card shadows. Accents: green `#22C55E`, amber `#D97706`, red `#DC2626`. Bold tight-kerned type, uppercase section labels.
