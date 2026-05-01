# ServiceOS — Arc State

> Last updated: 2026-04-30 (Day 3 wrap, after PR #22)
> Composes with: CLAUDE.md (operational rules), docs/audits/ (durable decision records), docs/feature-inventory.md (capability inventory), GitHub Issues + Projects (operational status)

## TOC
1. [Active arc](#1-active-arc)
2. [Current goals](#2-current-goals)
3. [PR queue (shipped)](#3-pr-queue-shipped)
4. [PR queue (planned)](#4-pr-queue-planned)
5. [Locked decisions](#5-locked-decisions)
6. [Open follow-ups](#6-open-follow-ups)
7. [Active backlog](#7-active-backlog)
8. [Deferred backlog](#8-deferred-backlog)
9. [Recent learnings](#9-recent-learnings)
10. [Tooling queue](#10-tooling-queue)
11. [Update log](#11-update-log)

---

## 1. Active arc

**PR-C arc** — closing 9 billing/race blockers from PR #13 audit + reconcileBalance() bypass remediation.

**State:** 10 PRs shipped (#13–#22). Currently between PR #22 (PR-C2 webhook dedup audit doc) and PR-C2-pre implementation.

**Audit blockers status:**
- C-1: refund-subtraction is intended totalPaid semantic — **CLOSED** in PR #20
- C-2: refund flow stamps voided_at on full refund — **CLOSED** in PR #21
- C-3: Site 4 payment-row dedup — **PENDING** in PR-C2
- D-1: surrogate UUID PK + unique compound index `(tenant_id, event_id)` — **PENDING** in PR-C2-pre
- D-2: stripe_events retention/prune — **DEFERRED** to follow-up PR
- D-3: entry-point dedup at `handleWebhook:392` with `INSERT...ON CONFLICT DO NOTHING` — **PENDING** in PR-C2-pre
- D-4: defense-in-depth — entry-point dedup AND Site 4 internal `paymentRepo.findOne` guard, NON-NEGOTIABLE — **PENDING** in PR-C2
- D-5: two-PR split — PR-C2-pre (table + entry-point guard) → PR-C2 (Sites 3+4 + Site 4 guard) — **PENDING**

**Next:** PR-C2-pre (stripe_events migration + entity + entry-point dedup INSERT)

---

## 2. Current goals

Goals point at GitHub Milestones. % complete auto-calculated from issue close rate once GitHub Issues are set up (Day 4 Stage 2).

- **PR-C arc completion** — close all `arc:PR-C` priority P0+P1 issues. Currently 10/13 (77%) — PR-C2-pre, PR-C2, PR-C1d remaining.
- **Multi-tenant readiness** — username/password auth for non-email users (P0 pre-launch blocker) + wildcard DNS + second-tenant onboarding playbook + Google OAuth tenant selector + RLS threat-model decision doc. Currently 0/5. Goal: ready to onboard tenant 2 within 30 days of last PR.
- **Production SMS** — Twilio A2P 10DLC + per-tenant SMS config + notification settings UI + driver branding. Currently 0/4. Blocked on Twilio upgrade decision.
- **Phase 2 features** — e-sign, permits, accounting integrations, advanced reports, GPS, admin tooling. Currently 0/6. Goal scope revisited after PR-C arc closes.

Goals revisit cadence: end of each arc (when all P0 closed in current milestone).

---

## 3. PR queue (shipped)

| PR | Commit | Description | Type | Date |
|---|---|---|---|---|
| #13 | `d14e445` | PR-C audit final | docs | 2026-04-30 |
| #14 | `706d304` | Ghost-chain repair record | docs | 2026-04-30 |
| #15 | `ece3dc0` | autoCloseChainIfTerminal expansion audit | docs | 2026-04-30 |
| #16 | `e19f81d` | PR-C1a — cancellation lock + chain closure | code | 2026-04-30 |
| #17 | `0dd4521` | PR-C1b-1 — Stripe idempotency keys (4 P0 sites) | code | 2026-04-30 |
| #18 | `db5d97f` | PR-C1b Stripe idempotency audit | docs | 2026-04-30 |
| #19 | `96e8c30` | reconcileBalance() bypass audit | docs | 2026-04-30 |
| #20 | `c6df605` | PR-C1c-pre — math fix + isFullyRefunded helper | code | 2026-04-30 |
| #21 | `9973f23` | PR-C1c — sync bypass replacements (Sites 1+2) | code | 2026-04-30 |
| #22 | `c899c68` | PR-C2 webhook dedup audit record | docs | 2026-04-30 |

---

## 4. PR queue (planned)

| ID | Description | Depends on | Status |
|---|---|---|---|
| PR-C2-pre | stripe_events migration + entity + entry-point dedup INSERT | PR #22 (audit, merged) | Ready |
| PR-C2 | Sites 3+4 webhook bypass replacements + Site 4 internal `paymentRepo.findOne` guard | PR-C2-pre | Blocked on PR-C2-pre |
| PR-C1d | Pessimistic invoice-row lock for chargeInvoice / refundInvoice | PR-C2 | Blocked on PR-C2 |
| (post-arc) | Phase 2 features OR subscriptions.service.ts SSoT arc OR RentThis MVP | PR-C1d | Open question |

---

## 5. Locked decisions

### From PR #19 (reconcileBalance bypass audit)
- **C-1** — refund-subtraction is intended `totalPaid` semantic. Refunds reduce paid total; this is correct, not a bug. **CLOSED in PR #20** with `isFullyRefunded` helper.
- **C-2** — refund flow stamps `voided_at` on full refund. PR #21 added the timestamp write to ensure downstream filters correctly identify voided invoices. **CLOSED in PR #21**.
- **C-3** — Site 4 payment-row dedup defers to PR-C2 alongside event-id dedup. Same code path, single PR cleaner. **PENDING in PR-C2**.

### From PR #22 (PR-C2 webhook dedup audit)
- **D-1** — surrogate UUID PK + unique compound index `(tenant_id, event_id)` for `stripe_events` table. Avoids natural PK problems with cross-tenant Connect events. **PENDING in PR-C2-pre**.
- **D-2** — defer retention/prune to follow-up PR. Premature optimization at current volume. **DEFERRED**.
- **D-3** — entry-point dedup at `handleWebhook:392` with `INSERT ... ON CONFLICT DO NOTHING RETURNING id` semantics. NOT `findOne` then `save` (TOCTOU race). **PENDING in PR-C2-pre**.
- **D-4** — defense-in-depth: entry-point dedup AND Site 4 internal `paymentRepo.findOne` guard. NON-NEGOTIABLE per audit (Site 4 has TWO compounding violations: lines 446-455 unconditional `paymentRepo.save` no findOne guard + lines 459-464 bypass write). **PENDING in PR-C2**.
- **D-5** — two-PR split: PR-C2-pre (migration + entity + entry-point guard) → PR-C2 (Sites 3+4 bypass replacement + Site 4 internal guard). Splits risk into smaller, separately verifiable units. **PENDING**.

---

## 6. Open follow-ups

These are audit-flagged but NOT current arc — separate PRs when convenient.

- **CLAUDE.md line 38 stale rule** — says `synchronize: true on in production` but `app.module.ts:74-79` has `synchronize: isTest` (TRUE only when `NODE_ENV === 'test'`; FALSE in dev/prod). Stale-rule fix is doc-only PR; standing-rule intent ("manual ALTER TABLE in Supabase BEFORE API deploy") remains correct. NOT bundled with PR-C2-pre or PR-C2.
- **stripe_events retention prune (D-2 follow-up)** — once table volume warrants it, add cron/background job to delete rows older than ~90 days (Stripe replay window + buffer). Index on `processed_at` already commented as TODO in PR-C2-pre migration.
- **account.updated tenant resolution** — Connect platform events have no payload-derivable tenant_id. Current resolution: `stripe_events.tenant_id` NULLABLE + PostgreSQL NULL-distinct semantics → dedup is best-effort for cross-tenant events. Re-evaluate if Connect usage grows and dedup correctness becomes operationally critical. Acceptable for current scale.

---

## 7. Active backlog

Current PR-C arc deliverables:

- [ ] **PR-C2-pre** — stripe_events migration + entity + entry-point dedup INSERT (next up)
- [ ] **PR-C2** — Sites 3+4 webhook bypass replacements + Site 4 internal `paymentRepo.findOne` guard
- [ ] **PR-C1d** — pessimistic invoice-row lock for chargeInvoice / refundInvoice

---

## 8. Deferred backlog

### Subscriptions / SSoT (separate audit pending)
- **subscriptions.service.ts SSoT arc** — pattern reference: PR #19 + PR #22. Likely has same canonical-writer-bypass shape. Audit decides scope before any implementation.

### Phase 2 — feature work
- E-sign integration (DocuSign / HelloSign-style)
- Permits module (municipal permit tracking + expiration alerts + document storage)
- Accounting integrations (QuickBooks Online + Xero)
- Advanced reports module (custom report builder, saved filters, scheduled exports, P&L by job/route)
- GPS / fleet management (real-time vehicle tracking, geofencing, driver hours-of-service)
- Admin tooling (tenant admin panel, user management, billing/subscription controls, audit log viewer)
- Notification settings UI (per-event SMS/email toggles)
- Driver branding (per-tenant SMS/email customization, customer-facing notification branding)

### Phase 3 — RentThis marketplace
- Marketplace scaffold exists in production code (MarketplaceModule, controller/service/DTOs/entities, marketplace_bookings and marketplace_integrations tables, jobs.marketplace_booking_id wiring)
- Remaining work: RentThis-facing marketplace product topology, public listing/feed surface, booking sync hardening, fee accounting, tenant opt-in/enablement, and customer-facing UX
- PRs already shipped in this area include public endpoint opt-in gating, accept transactionality, and marketplace customer dedup envelope cleanup

### Phase 4 — AI features
- Route optimizer (multi-stop with traffic + time windows + driver preferences)
- Smart SMS auto-responder
- Voice booking (voice-to-job intake)
- Revenue forecasting
- Demand heatmaps
- Cost-per-job calculations (real-time COGS attribution)
- OCR for dump tickets
- Predictive scheduling
- AI dispatch assistant
- Photo damage detection
- Voice notes auto-transcription

### Infra / ops
- **Username/password auth for non-email users** (PRE-LAUNCH BLOCKER, P0 — drivers + office staff)
- Twilio A2P 10DLC + upgrade decision (currently blocked)
- Wildcard DNS config for rentthisapp.com (multi-tenant — Vercel side live, DNS pending)
- RLS threat-model decision doc: current production state has RLS enabled on 56/56 public tables, but NestJS API currently relies primarily on app-layer tenant filtering; decide/document defense-in-depth-only vs primary API enforcement
- Quotes RLS policy outlier review (`current_setting('app.tenant_id')`, public role, ALL policy) vs canonical auth.jwt tenant pattern
- Optional FORCE ROW LEVEL SECURITY evaluation on the 6 policied tables
- E2E testing infrastructure (Playwright candidate)
- Customer autocomplete extraction (3 drifting impls — quote-send-panel 250ms, booking-wizard 300ms, new-customer-form 300ms; only QSP uses blur-close)
- Second-tenant onboarding playbook
- Notification settings UI
- Driver branding
- Tenant slug shortening (current UUID-derived `rent-this-dumpster-mnbxs4jm` → custom shorts like `rentthis`)
- Google OAuth tenant selector UI (deferred until tenant 2 onboarded)

### GTM
- ServiceOS app GTM
- Per-tenant tenant-app GTM
- Customer portal GTM

### Deferred
- 30yd / 40yd pricing reactivation (currently DEACTIVATED)
- Save card on file (Stripe Elements — frontend work)
- Recurring scheduling (multi-vertical strategy item)
- PWA / mobile-tablet responsive
- 4 P1 Stripe sites (customers.create, setupIntents.create, etc. — idempotency lower-risk than P0 sites already shipped)
- `partially_completed` enum lifecycle-semantics arc

---

## 9. Recent learnings

### Day 3 wrap (PRs #19–#22)

**STOP GATE 0 prevents branch-creation slip.**
PR-C1c-pre's run skipped branch creation, commit landed on `main` locally, 4-step recovery needed (cheap, but avoidable). Adding STOP GATE 0 as the first phase of every implementation prompt eliminated the issue for PR-C1c (PR #21) and PR #22.

**Display-layer diff collapse on `cat` is unavoidable today.**
Workarounds: paginated `sed` for large docs (PR #22 — 7 chunks of 80 lines covered all 578 lines), text-editor paste for diffs (`open -e /tmp/path/diff` then copy/paste), trust mid-flight `Update` tool output + behavioral verification (acceptable when paired with visual on highest-risk file).

**Plan Mode confirmation popup numeric input misfires.**
Pressing numeric keys after popup dismissal can register as plan rejection at CLI prompt. Workaround: explicitly say "that was a misfire, plan is approved, proceed."

**Mid-flight scope corrections land cleanly.**
PR-C1c-pre had three (file existence wrong, branch creation skipped, watch-too-early). Each was caught and announced explicitly rather than silently papered over. Pattern works because gates produce structured output that surfaces deviations.

**`--admin` discipline holds.**
Three consecutive code PRs (#17, #20, #21) with `api unit tests` Required check passing → dropped `--admin` for normal merge. Docs PRs (#19, #22) keep `--admin` because path filter doesn't match `api/**`.

**Phase 7A/7B sequencing prevents audit-and-write-as-one-pass.**
Splitting audit findings (7A) from doc-write (7B) gave us an explicit lock-decisions checkpoint between findings and artifact creation. Used in PR #22 audit; will reuse for future audits.

---

## 10. Tooling queue

When-to-revisit triggers for tooling additions evaluated tonight.

### Worth installing now (low friction)
- **Gemini CLI** — backup for queries larger than Claude context (~1M tokens). Use cases: full-repo architectural reviews, large-file diffs, audit-doc cross-references. ~5 min one-time install.

### When E2E testing kicks off (post-PR-C2)
- **Playwright MCP** — automate manual smoke checkboxes accumulating in PR bodies (charge invoice, full refund, partial refund, void invoice, etc.)
- **Chrome DevTools MCP** — frontend bug deep-dive (network/console inspection)

### When Phase 4 AI features kick off
- **LangChain / LangGraph** — multi-step agentic primitives
- **Ollama** — free local LLM sandbox for prototyping (no API spend)
- **DeepSeek-V3** — cheap bulk inference (OCR, categorization)
- **CrewAI** — multi-agent orchestration (more sober than RuFlow). NOT for billing code.

### When ops automation kicks off
- **n8n self-hosted** — workflow automation (tenant onboarding webhooks, marketplace sync, lead-gen)
- **n8n-MCP** — Claude Code drives n8n workflow creation

### When RentThis marketplace MVP starts
- **Dify** — full-stack AI app platform (customer-facing chatbot path)
- **Firecrawl MCP** — competitor pricing scraping, lead-gen pipelines

### When customer help / docs RAG matters
- **RAGFlow** or **LightRAG** — RAG infrastructure for tenant-facing AI help

### Trial on side project (NOT ServiceOS)
- **Superpowers (obra/superpowers)** — Claude Code plugin with brainstorming/planning/worktree skills. The `using-git-worktrees` skill specifically may help with branch-creation hygiene. Trial on RentThis MVP, not ServiceOS mid-arc.

### Conditional / use case-driven
- **UI UX Pro Max skill** — when frontend/portal work resumes
- **`/ultrareview`** — only if regressions slip past current 8-layer review stack
- **Sentry MCP** — if error rates climb or you need deeper production observability than current setup

### Skip outright
- OpenClaw, Claude Mem (already have via CLAUDE.md memory + conversation_search), Open WebUI, Awesome lists, Glif, Perplexity MCP, Obsidian Skills (not an Obsidian user), RuFlow (parallel agent swarm wrong shape for billing code)

---

## 11. Update log

Date-stamped entries appended at top. Each entry shows what changed in this file since the previous entry.

### 2026-04-30 (Day 3 wrap, this entry — initial creation)
- Initial creation of arc-state.md
- 10 PRs shipped in PR-C arc (#13–#22)
- 5 audit blockers locked: C-1 (closed PR #20), C-2 (closed PR #21), C-3 (pending PR-C2), D-1..D-5 (D-2 deferred, others pending)
- Day 4 morning plan: ship docs/arc-state.md (this), docs/runbooks/, docs/decisions/, docs/feature-inventory.md, GitHub Issues + Projects setup, then PR-C2-pre
- Pre-launch blocker filed: username/password auth for non-email users (drivers, office staff) — added to Multi-tenant readiness milestone
- Next: PR-C2-pre implementation (after Day 4 setup completes)
