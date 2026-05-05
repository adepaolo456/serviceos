# ServiceOS — Arc State

> Last updated: 2026-05-05 (arcS closed — legacy untracked artifacts cleanup)
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
| #85 | `8ca250c` | arcL — shorten tenant slug (`rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster`) | code | 2026-05-04 |

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

### 2026-05-05 (arcS closed — legacy untracked artifacts cleanup)

- **Goal.** Sub-arc-sized cleanup of legacy untracked artifacts that had been hovering in the working tree since arcO. Each PR over the last 4 arcs (O/P/Q/R) had to actively dodge this clutter; arcR Phase 1a's `git add -A` near-miss made the cost concrete. arcS resolves it before it bites again.
- **Decision recorded.** 3-bucket categorization (gitignore / commit / remove). Pre-flight diff requirement before any "remove" bucket execution to catch label-reuse / non-subset-draft cases.
- **Pre-flight diff finding (high-value catch).** Repo-root `arcK-phase0-audit-report.md` (265 lines, dated 2026-05-04) initially classified for removal as a presumed superseded draft of the tracked `docs/audits/arcK-phase0-audit-report.md` (649 lines, dated 2026-04-25). Full `diff` revealed the two files are **unrelated audits sharing the `arcK` label 9 days apart**: the tracked April 25 version is the **Sentry integration** audit; the untracked May 4 version is the **dead-tenant `ef0aa720` cleanup probe** (verdict "DO NOT DELETE — TARGET DOES NOT EXIST"). Reclassified remove → commit-with-rename. Landed at `docs/audits/2026-05-04-dead-tenant-ef0aa720-audit.md` (date-prefix convention to avoid future label collision).
- **Verdict.** SAFE. Three explicit per-category decisions, mechanical execution.
- **Phase 1 — work (Claude Code).** PR [#107](https://github.com/adepaolo456/serviceos/pull/107) squash `fa30a1f` (10 files, +3721/0). 1 `.gitignore` line added (`.claude/worktrees/`); 9 audit docs committed (6 relocated from repo root, 1 relocated+renamed via date prefix to resolve arcK label reuse, 2 added in place at `docs/audits/`). 0 files removed (bucket emptied by reclassification). Working tree genuinely clean for the first time since arcO.
- **Phase 1c — closure (this commit).** Retroactive board card creation + arc-state §11 entry. arcS Phase 0/1 prompts incorrectly applied a sub-arc exception that doesn't actually exist as convention (referenced an "arcO precedent" that wasn't real). Closure docs PR catches up before convention drift compounds. **Sub-arc work still gets a board card** going forward.
- **Lessons captured.**
  - **arc-label reuse hazard.** When an arc letter gets reused (intentionally or accidentally), check existing audit docs for the same label before treating any duplicate as a draft. Date-prefix convention (`YYYY-MM-DD-topic.md`) is preferred for non-arc-aligned audits to avoid collision. arcK was reused once (April 25 Sentry → May 4 dead-tenant); future reuse should be explicit with date prefix from the start.
  - **`git mv` requires tracked sources.** Falls back to `mv` + `git add` for untracked sources. End-state identical, but git records the operation as Add (not Rename) in the diff because the source path was never in any prior tree. No history lost since pre-relocation history of untracked files is empty by definition.
  - **Pre-flight `diff` (full, not `-q`) before any "remove" bucket execution.** `diff -q` only confirms files differ; full `diff` reveals subset vs divergent. arcS's pre-flight prevented destructive deletion of unique audit content. Codify: every "remove" bucket entry gets a full-diff verdict before the `git rm` lands.
  - **Sub-arc work still gets a board card.** arcS shipped without one (corrected retroactively here); future sub-arc-sized work follows the same Backlog → Ready → Done flow as full arcs. The cost is ~5 minutes; the benefit is convention consistency, a discoverable §11 entry, and no precedent drift.
- **Audit doc reference.** None (sub-arc; the Phase 0 inventory + 3-bucket categorization lived in chat).
- **Companion files committed in `fa30a1f`.**
  - `docs/audits/arcH-phase0-audit-report.md` (relocated + typo fix from `archH`)
  - `docs/audits/arcJ1-phase1-deliverables.md`
  - `docs/audits/arcJ1e-phase0-audit-report.md`
  - `docs/audits/arcJ1e-phase1-deliverables.md`
  - `docs/audits/arcJ1f-phase0-audit-report.md`
  - `docs/audits/arcL-phase0-audit-report.md` (closes a §11 gap — arcL closure was previously docs-less)
  - `docs/audits/2026-05-04-dead-tenant-ef0aa720-audit.md` (relocated + renamed via date prefix to resolve arcK label reuse)
  - `docs/audits/2026-04-28-class-a-regression-varchar-tenant.md` (already in canonical location)
  - `docs/audits/2026-04-28-shared-placeholder-sweep.md` (already in canonical location)
- **Manual TODO post-closure.** None. Work was already complete; this Phase 1c is documentation catch-up only.
- **Board card.** Issue #108, project item `PVTI_lAHOAZbXz84BWRGTzgr39aI`, milestone `Pre-launch polish` (#6). Status set directly to Done at card creation since work has shipped; auto-close fires when this closure PR's `Closes #108` triggers.

### 2026-05-05 (arcR closed — stale legacy host fallback cleanup)

- **Goal.** Broad sweep across `api/` and `web/` for stale legacy host fallback literals (`serviceos-api.vercel.app`, `serviceos-web-zeta.vercel.app`, `serviceos.com` apex) that arcN's "flip every fallback default" pass missed and arcQ § 3a remembered. arcR's re-grep widened the scope and also caught **2 functional regressions** from arcQ's incomplete sender/listener scope: `web/src/app/site/{book,confirmation}/page.tsx` were emitting the old `serviceos-{close,booking-complete}` postMessage event types while widget.js (arcQ-renamed) was listening for the new `rentthisapp-*` types — silent break with zero blast radius today (no embeds), but the contract was misaligned.
- **Decision recorded.** Bundle the 2 postMessage sender fixes into arcR rather than splitting into a separate arc. Use canonical fallbacks per Phase 0 DNS preflight: `rentthisapp.com` for `NEXT_PUBLIC_TENANT_DOMAIN`, `https://rentthisapp.com` (apex) for Powered-by hrefs. Preflight verified the apex serves HTTP 308 → `app.rentthisapp.com`, Vercel-served, no third-party destination.
- **Verdict.** SAFE WITH CAVEATS. 9 hygiene fallbacks + 4 drift sites + 2 functional regressions = 15 line edits across 11 files in one bundled PR.
- **Phase 1a — code (Claude Code).** PR [#105](https://github.com/adepaolo456/serviceos/pull/105) squash `526997d` (11 files, +15/−15). Files touched: `api/src/modules/portal/portal.service.ts`, `api/src/modules/subscriptions/subscriptions.service.ts`, `api/src/modules/automation/automation.service.ts`, `web/src/app/site/tenant-context.tsx`, `web/src/app/site/book/page.tsx` (×3 line edits — line 11 fallback, line 210 postMessage sender, line 515 Powered-by), `web/src/app/register/page.tsx`, `web/src/app/(dashboard)/invoices/page.tsx`, `web/public/widget-test.html`, `web/src/app/quote/[token]/page.tsx`, `web/src/app/site/layout.tsx`, `web/src/app/site/confirmation/page.tsx` (×2 line edits — line 34 postMessage sender, line 36 Powered-by). API `nest build` and web `tsc --noEmit` both clean.
- **API deploy.** `dpl_yyjy9abF5eDvdrRLpZYoSgmufFQT` — Sentry release pinned to `526997d` via `--build-env VERCEL_GIT_COMMIT_SHA`. READY post-deploy.
- **Web auto-deploy.** `serviceos-c0lkrq5l3-adepaolo456s-projects.vercel.app` (`dpl_Ec84r5T6wQ9ZXezj4Jz8rb5d31JC`), READY at 35s build (post-PR-#105 merge).
- **Phase 1b — verification (Claude Code).** API `/health` → `{"status":"ok","commit":null,"timestamp":"2026-05-05T16:40:24.671Z"}` — `commit:null` acceptable per arcO § 1c.1 (`?? null` → `|| null` lesson; runtime lambda env exposes empty string). Web bundle: 5 routes fetched cache-busted (`/site/book`, `/register`, `/quote/test-token`, `/site/confirmation`, `/login` substituted for `/(dashboard)/invoices` since dashboard requires JWT), 14 unique chunks discovered + downloaded. Bundle grep table: all 4 NEW tokens ≥ 1 (`https://api.rentthisapp.com` = 10 occ in 7 files, `rentthisapp-close` = 2 occ in 2 files, `rentthisapp-booking-complete` = 2 occ in 2 files, `https://rentthisapp.com` = 3 occ in 3 files), all 6 OLD tokens = 0 (`https://serviceos-api.vercel.app`, `https://serviceos-web-zeta.vercel.app`, `serviceos.com`, `serviceos-close`, `serviceos-booking-complete`, `serviceos.io`). ROOT_DOMAINS retention allowance not consumed: `extractSlugFromHost.ts` is server-only middleware code, not bundled into client chunks. **postMessage contract verified** end-to-end: widget.js (arcQ-renamed listener) carries `rentthisapp-close`=1, `rentthisapp-booking-complete`=1; chunk_10 (confirmation/page) sends `rentthisapp-close`, chunk_12 (book/page) sends `rentthisapp-booking-complete` — sender ↔ listener round-trip intact. widget-test.html: new embed snippet `https://api.rentthisapp.com/widget.js` = 1, old snippet `https://serviceos-web-zeta.vercel.app/widget.js` = 0.
- **Phase 1c — closure (this commit).** Docs PR landed via squash merge with `--admin`. Card #104 flipped Ready → Done at this commit; auto-close fires per arcM § 6.5.
- **Site count drift lineage.** arcQ § 3a remembered 7 fallback sites; arcR re-grep found 15 (9 hygiene fallbacks including `subscriptions.service.ts:93+119` which arcQ counted as 1 but had 2 identical literals + 4 drift sites + 2 functional regressions). The undercount lineage is benign — arcQ's narrow scope was honest about being widget-only, and arcR was always the planned cleanup arc for the broader sweep. Captures a counting-precision gap worth preserving: literal-pattern rename arcs should re-grep at execution time, not trust audit-time counts.
- **Lessons captured.**
  - **`Tracks #N` phrasing held its ground in a second arc.** Issue #104 stayed OPEN through Phase 1a/1b (verified `closed: false, closedAt: null` immediately before this Phase 1c flip), then closed intentionally when the project Status field flipped Ready → Done. Two consecutive arcs (#101, #104) confirm the workaround is the right pattern. Use `Tracks #N` or `Part of #N` in work-PR bodies; reserve `Closes #N` for the closure-docs PR body.
  - **`git add -A` near-miss + soft-reset recovery.** First commit attempt swept untracked prior-arc clutter (audit reports from arcJ1/K/L, the embedded `.claude/worktrees/` directory, in-flight `docs/audits/2026-04-28-*.md` files) into staging. Caught via the `warning: adding embedded git repository` output; resolved with `git reset --soft HEAD~1` then `git reset` to clear index, then explicit `git add <file1> <file2> …` for the 11 in-scope files. **Future arc commits should use explicit file paths** (or a per-arc `git add api/ web/` scope) until the legacy untracked artifacts get a separate cleanup decision (commit / gitignore / remove). The artifacts have been hovering since arcO and warrant their own resolution arc.
  - **Sender/listener pairing audit on cross-file public-API renames.** arcQ's narrow scope (widget.js only) missed the postMessage **senders** in `web/src/app/site/`. Future cross-file public-API renames need a paired-grep verification step that explicitly checks the *other* side of the contract (the side NOT being touched by the planned arc), not just the renamed file. Concretely: for any `addEventListener("X", ...)` change, grep for `postMessage({type:"X"…})` and vice-versa, both in the same arc.
  - **DNS preflight before customer-facing literal changes.** arcR's Phase 0 preflight on `https://rentthisapp.com` confirmed apex redirect to `app.rentthisapp.com` (HTTP 308, Vercel-served, no third-party destination). Apply this pattern before any future customer-facing href change to a domain we may or may not own — even when the destination "obviously" should be ours, a preflight catches typo'd domains, parked domains, and competitor squatting before they ship.
- **Audit doc reference.** `docs/audits/2026-05-05-arcR-stale-legacy-host-cleanup-audit.md`. Closure footnote appended in this commit.
- **Manual TODO post-closure (Anthony, browser-only — Claude Code can't authenticate to dashboard or load tenant subdomains from CLI).**
  1. Visit a real `/quote/[token]` page (recent quote token from production) → verify Book Now CTA href contains `rentthisapp.com`, not `serviceos.com`. Code path: `web/src/app/quote/[token]/page.tsx:80`.
  2. Visit `/site/book` on a tenant subdomain (e.g., `https://rent-this-dumpster.rentthisapp.com/site/book`) and inspect the Powered-by link in the footer — should resolve to `https://rentthisapp.com`. Same for `/site/confirmation` and the `/site` layout footer.
  3. Visit `/(dashboard)/invoices` logged in as tenant admin, click CSV export, confirm DevTools Network tab shows the request firing to `api.rentthisapp.com/reporting/invoices/export?...`. Code path: `web/src/app/(dashboard)/invoices/page.tsx:504`.
  4. Sentry release sanity: trigger any API error (or check next ingested event) and confirm release tag is `526997d`.
  5. End-to-end embed iframe round-trip if/when a test embed exists (low priority — embeds = 0 today).
- **Board card.** Issue #104, milestone `Pre-launch polish` (#6). Status flipped Ready → Done at this Phase 1c commit; auto-close fires per arcM § 6.5 expected behavior.

### 2026-05-05 (arcQ closed — widget public-API brand rename)

- **Goal.** Force-rename the widget's public-facing identifiers from ServiceOS-era to RentThisApp-era per CLAUDE.md "Brand split" rule. Original "PR-5 force-break" framing retired (audit § 6 → § 7 resolution): no surviving widget API compat path to break (single-version `widget.js`, no aliases, no deprecated routes). arcQ proceeds as a public-API brand rename only.
- **Decision recorded.** Re-scope from "force-break" to "public-API brand rename" because audit found no surviving widget API compat path. **Zero embeds = cheapest moment to rename** (heuristic captured below).
- **Namespace decision.** `window.RentThisApp` (NOT `window.RentThis` — collides with the separate RentThis.com marketplace product per CLAUDE.md "Brand split" rule).
- **Casing conventions** (applied per-surface, not normalized): PascalCase namespace (`window.RentThisApp`), camelCase callback (`window.rentThisAppOnBooking`), lowercase-hyphenated DOM events (`rentthisapp-booking-complete`), DOM ids (`rentthisapp-widget-*`), and CSS @keyframes (`rentthisapp-fadein`, `rentthisapp-scalein`); brand-cased console prefix `[RentThisApp]`.
- **Phase 1a — code (Claude Code).** PR [#102](https://github.com/adepaolo456/serviceos/pull/102) squash `8e8eb75` (2 files, +23/−23). Touched only `web/public/widget.js` (19 line edits) and `web/public/widget-test.html` (4 line edits). Lockstep `@keyframes` def + `animation:` ref pairing landed in the same commit for both `fadein` and `scalein`. Hosts unchanged. Endpoint unchanged. No alias layer. Typecheck clean (widget.js is plain JS in `web/public/` static-asset folder, not directly typechecked by tsc; full project tsc pass confirmed no TS file regression).
- **Web auto-deploy.** `dpl_2VRboVGeLjCG212k9U1ifgwH6hsH`, READY at `2026-05-05T15:51:19Z` (4 seconds post-PR-#102 merge), commit `8e8eb75`.
- **Phase 1b — verification (Claude Code).** Cache-busted fetch of deployed `widget.js` returned **5879 bytes** — exact byte match with local `main` (pure literal substitution; no length-shifting code paths). 16/16 token criteria pass:
  - **NEW tokens** (must be ≥ 1 each): `window.RentThisApp`=1, `[RentThisApp]`=3, `rentthisapp-widget-`=7, `rentthisapp-fadein`=2 (def + ref paired), `rentthisapp-scalein`=2 (def + ref paired), `rentthisapp-booking-complete`=1, `rentthisapp-close`=1, `rentThisAppOnBooking`=2 (typeof + invocation).
  - **OLD tokens** (must be 0 each): all 8 = 0 (no `ServiceOS`, no `serviceos-widget-`, no `serviceos-{fadein,scalein,booking-complete,close}`, no `serviceosOnBooking`, no `window.ServiceOS`).
  - **Host literals** preserved: `https://api.rentthisapp.com` = 1, `https://app.rentthisapp.com` = 1.
  - **widget-test.html** post-deploy: `RentThisApp.open()` = 2 (onclick + button text on line 25), `ServiceOS.open()` = 0, `window.rentThisAppOnBooking` = 2 (doc snippet + live script), `window.serviceosOnBooking` = 0. Deferred line 31 legacy host URL acknowledged but not failing (out of arcQ scope; arcQ′ scope).
- **Phase 1c — closure (this commit).** Docs PR landed via squash merge with `--admin`. Card #101 flipped Ready → Done at this commit; auto-close fires per arcM § 6.5.
- **Lessons captured.**
  - **`Tracks #N` phrasing successfully dodged GitHub's eager auto-close detector.** Issue #101 stayed OPEN through Phase 1a/1b (verified `closed: false, closedAt: null` immediately before this Phase 1c flip), then closed intentionally when the project Status field flipped Ready → Done. This is the **first arc** to use the workaround successfully and validate it. Confirms it's the right pattern for arcs where closure should come from the closure docs PR rather than the work PR. Use `Tracks #N` or `Part of #N` in work-PR bodies; reserve `Closes #N` for the closure-docs PR body.
  - **Cheapest-moment heuristic for public-API renames.** When blast radius is zero (no live consumers), force-rename without aliases. Once consumers exist, the same rename requires versioning, aliases, migration docs, and backwards-compat — orders of magnitude more work. Apply to future public-surface renames (API key prefixes, embed namespaces, public DOM events, etc.). The heuristic is: *if zero consumers today and a rename is even directionally desirable, do it now*.
- **Audit doc reference.** `docs/audits/2026-05-05-arcQ-widget-force-break-audit.md`. Note: filename retains `force-break` suffix from Phase 0 even though the arc was re-scoped at § 7. Not worth renaming — the file is referenced by SHA-pinned commit messages and PR bodies.
- **Deferred follow-up (arcQ′, intent recorded only — not created now).** 7 stale env-var fallback sites in audit § 3a + the legacy host URL on `widget-test.html:31`. Single audit-first PR later; treated as arcN/rebrand hygiene, not widget API rename. **Do not create the audit doc or board card for arcQ′ now.**
- **Manual TODO post-closure (Anthony, browser-only).** Load `https://app.rentthisapp.com/widget-test.html` in a browser. Confirm "Test Controls" button text shows `RentThisApp.open()`. Click it → confirm widget overlay opens and a new floating "Book Now" button appears with id `rentthisapp-widget-btn` (DevTools → Elements → search). Optional: complete a booking flow → confirm `[RentThisApp]` console prefix on any error logs.
- **Board card.** Issue #101, project item `PVTI_lAHOAZbXz84BWRGTzgr3bac`, milestone `Pre-launch polish` (#6). Status flipped Ready → Done at this Phase 1c commit; auto-close fires per arcM § 6.5 expected behavior.

### 2026-05-05 (arcP closed — API Access card honesty cleanup)

- **Goal.** Convert two existing Settings "API Access" / "API Key" cards to honest **Coming Soon** states. Remove the fake `rta_live_*` value derived from `tenant.id` (strip hyphens, slice first 24 chars, prefix `rta_live_`). Both cards remain visible — the long-term decision about where real API-key management UI lives is deferred to the future integration-readiness arc.
- **Decision recorded: Option 1.** Update both cards in place. **Do not** remove either card. **Do not** redesign Settings IA. **Do not** decide the long-term two-surface UX inside arcP.
- **Verdict.** SAFE. Single web file, no API/DB/env touch.
- **Phase 1a — code (Claude Code).** PR [#99](https://github.com/adepaolo456/serviceos/pull/99) squash `0896084` (1 file, +13/−23). Touches only `web/src/app/(dashboard)/settings/page.tsx`. `IntegrationsTab` "API Key" card body replaced with the existing webhook Coming Soon pattern (PR #82) — muted code element rendering "API keys coming soon", Eye + Copy buttons removed. `AccountTab` "API Access" card replaced with subtitle copy + disabled `aria-disabled` text input rendering "API keys coming soon", Eye toggle + Regenerate Key + API Docs buttons all removed (the latter two had no `onClick` anyway). `Eye, EyeOff` removed from the lucide-react import (now unused). Typecheck clean.
- **Web auto-deploy.** `dpl_2AZHLWJ7jJEEHK8TpUZfayS3zkUe`, READY at `2026-05-05T15:06:21Z` (3 seconds post-merge), commit `0896084`.
- **Phase 1b — verification (Claude Code).** 15-chunk dashboard bundle grep across the deployed web build:
  - `rta_live_` total = **0** ✓ (was the fake-key prefix; gone from bundle)
  - `tenant.id.replace` total = **0** ✓
  - `tenantId.replace` total = **0** ✓
  - `API keys coming soon` total = **2** ✓ (matches the two converted surfaces, both in chunk `04g2l6_tp_08-`)
  - `Coming soon — API keys` total = **2** ✓
  - 32-hex UUID-stripped substrings = **0** ✓
  - Other Settings tabs intact in deployed bundle: Profile (4), Website (4), Quotes (5), Billing (31), Integrations (1), Account (12), Notifications (9). No regression markers.
- **Backend orphan check.** Zero `@Controller`/`@Get`/`@Post` routes in `api/src` for `api_key|apiKey|api-key|regenerate`. The only `apiKey` references are inside `notifications/services/resend.service.ts` (internal Resend SDK secret, unrelated). No backend route to remove. The Eye toggles in arcP were local React state; Copy was a browser-clipboard call only; Regenerate Key + API Docs buttons had zero `onClick` handlers. Confirms the framing in PR #83's commit message ("the displayed key remains deterministically derived from tenant.id with no backend auth").
- **Lessons captured.**
  - **Bash session PATH-corruption pattern after `vercel inspect`.** During Phase 1b verification, invoking `vercel inspect` from inside a Bash tool call corrupted the inherited PATH for the rest of that shell, causing `command not found` errors for `curl`, `ls`, `head`, `wc`, etc. Recovery: explicitly set `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"` at the top of subsequent calls, or fall back to absolute paths (`/bin/echo`, `/usr/bin/grep`, etc.). Worth knowing for future Claude Code Bash sessions that mix Vercel CLI with follow-up shell ops.
  - **Chunk-download loop pitfall.** A multi-line `$VAR` expansion in a bash `for c in $VAR` loop produced 0-byte output files because the entire multi-line string was treated as a single iteration item. Fix: use `while IFS= read -r line; do … done < /tmp/chunks-list.txt` with the chunk URLs in a heredoc list file. The 0-byte-file failure was silent — the per-criterion grep returned all zeros (including for known-good control strings like "Profile"), which was the diagnostic clue. After fix, ran cleanly across all 15 chunks.
  - **Stale chunk reference (cosmetic).** The `/settings` HTML shell on this deploy still references one chunk URL (`16e24w0s.w~uj.js`, 9 bytes — HTML 404) carried over from a prior deploy's manifest. Non-blocking. File as a small cosmetic followup if it persists across multiple deploys; ignorable for now.
- **Audit trail.** `docs/audits/2026-05-05-arcP-api-access-card-honesty.md` (Phase 0 audit; closure footnote appended in this commit recording PR #99 SHA, deploy id, Phase 1b verification scorecard, and the debugging detour). Note the file suffix is `-honesty.md` (not `-audit.md` per a typo in an earlier prompt — flagged at Phase 1a).
- **Manual TODO post-closure (Anthony).** Browser-only DOM verification (Claude Code can't authenticate to `/settings` from CLI):
  - Load `https://app.rentthisapp.com/settings` as authenticated tenant.
  - **Integrations** tab → API Key card shows "API keys coming soon" muted, no Eye/Copy buttons.
  - **Account** tab → API Access card shows new subtitle + disabled `API keys coming soon` input, no Eye/Regenerate/API Docs buttons.
  - DevTools → Network → confirm zero requests to `*regenerate*`, `*api-keys*`, `*api-docs*`.
  - DOM Inspector → confirm no `rta_live_…` substring or 32-hex UUID-stripped substring in either card region.
- **Board card.** Issue #98, project item `PVTI_lAHOAZbXz84BWRGTzgr3Koc`, milestone `Pre-launch polish` (#6). Status flipped Ready → Done at this Phase 1c commit; auto-close fires per arcM § 6.5 expected behavior.

### 2026-05-05 (arcO closed — small pre-launch cleanup batch)

- **Goal.** Four isolated pre-launch cleanup items in one arc: ship a `GET /health` endpoint (Path A — hand-rolled, no `@nestjs/terminus`); resolve three stale URL follow-ups surfaced by arcN PR #90 (widget.js APP host, settings websiteUrl, auth.controller frontendUrl fallback); document the live `idx_customers_tenant_email_unique` partial unique index on `customer.entity.ts` via `@Index` decorator (documentation-as-code); fix the stale `/* Logo — just green "OS" */` comment in `sidebar.tsx`. Single PR / single squash commit / single API deploy planned, with a Phase 1c.1 amendment for the `/health` JSON shape fix discovered post-deploy.
- **Verdict.** SAFE. 4 isolated low-risk changes. Audit doc 164 lines, slightly over the 60–100 target due to the TypeORM `synchronize: isTest` safety analysis on Item 3 + per-item verification tables.
- **Phase 1a — code (Claude Code).** PR [#95](https://github.com/adepaolo456/serviceos/pull/95) squash `f959e24` (7 files, +40/−5). New `api/src/health.controller.ts`; HealthController registered in `app.module.ts` controllers array; auth.controller.ts:420 fallback swapped to `https://app.rentthisapp.com` (symmetric with line 376); customer.entity.ts class-level `@Index` decorator + JSDoc fidelity-gap note; widget.js:5 APP swapped to `https://app.rentthisapp.com`; settings page websiteUrl swapped to `${slug}.rentthisapp.com`; sidebar.tsx:254 comment updated.
- **Phase 1b — API deploy (Claude Code).** `dpl_DVTUHKoYV7uAYcPu6Z245bv5FPn2` (build 16s, total 37s) with Sentry release pinned to `f959e24`. Aliased to both `https://api.rentthisapp.com` (canonical post-arcN) and `https://serviceos-api.vercel.app` (retained alias).
- **Phase 1c — `/health` smoke (Claude Code).** Status `"ok"` and HTTP 200 on both aliases (new `api.rentthisapp.com` and old `serviceos-api.vercel.app`). Surfaced one shape deviation: `commit` returned `""` (empty string) rather than the audit's expected SHA-or-`null`. Diagnosis: Vercel runtime exposes `VERCEL_GIT_COMMIT_SHA` as empty string, and `??` only triggers on `null`/`undefined`.
- **Phase 1c.1 — `/health` commit null-shape fix (Claude Code).** Single-character operator change in `api/src/health.controller.ts`: `?? null` → `|| null`. PR [#96](https://github.com/adepaolo456/serviceos/pull/96) squash `5995500` (1 file, +1/−1). API redeployed via `dpl_ERzqp3isdBRuTMcqyAchksiEmSC5` (Sentry release pinned to `5995500`). Re-smoke confirmed `{ status: "ok", commit: null, timestamp: <fresh ISO> }`.
- **Phase 1d — Web auto-deploy verification (Claude Code).** Latest `serviceos-web` Production deploy `dpl_9bzruM9sAsHujFD6Q4WZg3W65bP1` (action: github auto-deploy on PR #96 merge, commit `5995500`, target production, READY at `2026-05-05T14:19:03Z`). Cache-busted `widget.js` confirms both `var API = 'https://api.rentthisapp.com';` and `var APP = 'https://app.rentthisapp.com';` are live. `/login` bundle grep across 12 chunks: 6 `rentthisapp.com` hits, 0 `serviceos.com` hits, 0 `serviceos-web-zeta.vercel.app` hits.
- **Phase 1e — closure (this commit).** Docs PR landed via squash merge with `--admin` (consistent with arcL/arcM/arcN/arcO hygiene). Card #94 flipped Ready → Done; GitHub Projects auto-close-on-Done workflow closes the linked issue per arcM § 6.5.
- **Lessons captured.**
  - **`VERCEL_GIT_COMMIT_SHA` exposure.** `--build-env VERCEL_GIT_COMMIT_SHA=…` injects the variable at **build time** — that's enough for Sentry release pinning (the SHA is baked into the build artifact), but the **runtime lambda env** does not get the same variable populated. The runtime exposes `VERCEL_GIT_COMMIT_SHA` as an empty string by default. For runtime fallbacks, prefer `process.env.X || null` over `process.env.X ?? null` so empty string is treated as missing.
  - **Workflow refinement: card created at scoping (Phase 0), not closure.** arcL/arcM/arcN cards were created retroactively because their scope was clarified mid-execution. arcO is the first arc with the project-board card created in **Ready** during Phase 0, then flipped to Done at Phase 1e. Backlog→Ready→Done is the right lifecycle when the audit settles scope before execution begins. Documented in audit doc § "Workflow refinement" + reflected in Phase 0's authorized board mutation.
  - **Edit tool vs Bash inspection (procedural).** Three Edit calls in Phase 1a failed because Bash `sed`/`grep` doesn't satisfy the Edit tool's "must Read first this session" prerequisite. Recovered cleanly by issuing Read calls for the three files, then re-applying. Future arcs: use the Read tool for any file you intend to Edit, not Bash inspection.
- **Audit trail.** `docs/audits/2026-05-05-arcO-small-cleanup-plan.md` (Phase 0 audit + phase-gated execution plan, with closure footnote appended in this commit recording all PR SHAs, deploy ids, and smoke results).
- **Manual TODO post-closure (Anthony).** None for arcO. The follow-up "make `commit` return the actual SHA at runtime" is intentionally deferred (out of arcO scope per Phase 1c.1 amendment); pursue separately if needed.
- **Board card.** Issue #94, project item `PVTI_lAHOAZbXz84BWRGTzgr2pUE`, milestone `Pre-launch polish` (#6). Status flipped Ready → Done at this Phase 1e commit; auto-close fires per arcM § 6.5 expected behavior.

### 2026-05-05 (arcN closed — `api.rentthisapp.com` cutover)

- **Goal.** Move the production API off `serviceos-api.vercel.app` onto `api.rentthisapp.com` so customer-facing URLs (OAuth, widget, marketplace, future Stripe webhook) match the customer-facing brand. Web side already lives at `app.rentthisapp.com` + `*.rentthisapp.com` (arcL).
- **Verdict.** B + C — small code change first, then env-var config. Phase-gated execution (1a → 1j) with explicit STOP/report boundaries between automated and manual phases.
- **Phase 1a — code (Claude Code).** PR #90 squash `6eca896` (11 files, +17/−17). Hardcoded literal swaps + env-var fallback default flips. driver-app deferred (Expo mobile, separate cycle). `api/api/index.js` legacy CORS shim untouched (separate refactor).
- **Phase 1b — Vercel pre-flight inspect (Claude Code).** `vercel domains inspect api.rentthisapp.com` showed clean slate; the wildcard `*.rentthisapp.com` on the web project covers the subdomain implicitly today, no explicit conflict.
- **Phase 1c — env vars + OAuth URI (Anthony, manual).** Set 5 env vars on `serviceos-api` Production (`GOOGLE_CALLBACK_URL`, `API_DOMAIN`, `TENANT_DOMAIN`, `WEB_DOMAIN`, `FRONTEND_URL`) + 1 on `serviceos-web` (`NEXT_PUBLIC_API_URL`). Added new redirect URI to ServiceOS OAuth client in Google Cloud Console (project `rock-baton-393311`); old URI retained alongside.
- **Phase 1d — API deploy (Claude Code).** `vercel --prod --build-env VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)` shipped `dpl_AP5vcFB7rAFv6RJ5qPNpt7kUi9dq` with Sentry release pinned to `6eca896`.
- **Phase 1e — domain attach + cert (Anthony, manual).** `api.rentthisapp.com` attached to `serviceos-api` project; Valid Configuration. Vercel reused the existing wildcard `*.rentthisapp.com` cert from the web project (Let's Encrypt R13) — same cert serves both, separate renewal isn't needed.
- **Phase 1f — read-only smoke (Claude Code).** All four checks pass: `https://api.rentthisapp.com/` 401 (NestJS auth gate, expected); `https://serviceos-api.vercel.app/` 401 (alias intact); `/public/tenant/rent-this-dumpster` 200 with `slug` confirmed; TLS valid (TLSv1.3, Let's Encrypt R13, h2). Cosmetic anomaly noted: bare `/` route reflects `access-control-allow-origin: https://serviceos-web-zeta.vercel.app` from the legacy `api/api/index.js:3` shim — pre-existing, deferred from arcN scope.
- **Phase 1g — Stripe webhook URL edit — DEFERRED to a separate audit-first arc.** Pre-condition for the audit's edit-in-place plan was that a Live-mode Stripe webhook endpoint exists; it does not (no Live customer payments yet). Phase 1g status: SKIPPED / NO-OP. The edit-in-place reasoning remains technically sound and is captured as a durable lesson for the future Stripe Live webhook setup arc.
- **Phase 1h — Web redeploy verification (Claude Code).** Initial check failed: latest production deploy `dpl_4EhpAqnp7HzL4FCxH3PLhtYsnaXv` was created at PR #90 merge BEFORE Phase 1c set the new env var, so the JS bundle still had `serviceos-api.vercel.app` baked in (env var overrides fallback at build time). Anthony manually triggered a Vercel UI Redeploy of the production deployment. Verified result on `dpl_Dm187nj9K8mzXJUL7JN9mft42UMH` (action: redeploy, originalDeploymentId: `dpl_4EhpAqnp7HzL4FCxH3PLhtYsnaXv`, target: production, build time 42s): bundle grep across all 12 chunks showed `api.rentthisapp.com` 6 hits, `serviceos-api.vercel.app` 0 hits.
- **Phase 1i — E2E (mixed).** OAuth login E2E in fresh incognito: `app.rentthisapp.com/login` → "Sign in with Google" → authenticated dashboard. Tenant data, sidebar branding, notifications, session pill all rendered correctly with no console errors, no CORS issues, no `redirect_uri_mismatch`. Tenant subdomain curl `https://rent-this-dumpster.rentthisapp.com/` returned HTTP/2 200 with valid TLS. API public-tenant resolution on new host returned `slug: "rent-this-dumpster"`. Stripe round-trip skipped per Phase 1g amendment.
- **Phase 1j — closure (this commit).** Docs PR landed via squash merge with `--admin` (consistent with arcL/arcM hygiene); arcN board card created in `Pre-launch polish` milestone with status Done; follow-up Backlog card created for the future Stripe Live webhook setup arc.
- **Stripe webhook route — durable reference (for future arc).** `POST /stripe/webhook` defined at `api/src/modules/stripe/stripe.controller.ts:7,89`. Single `STRIPE_WEBHOOK_SECRET` reader at `api/src/modules/stripe/stripe.service.ts:384` (used by `stripe.webhooks.constructEvent` for signature verification). Existing test fixtures live in `api/src/modules/stripe/stripe.service.spec.ts`. The cutover URL the future arc will need to register at Stripe is `https://api.rentthisapp.com/stripe/webhook`.
- **Lessons captured.**
  - **`NEXT_PUBLIC_*` env vars require a manual web redeploy.** Setting the env var alone is insufficient — Next.js bakes `NEXT_PUBLIC_*` values into JS bundles at build time, so the previous bundle continues serving the old value until a fresh build runs. Triggering "Redeploy" via Vercel UI is the explicit user action the audit's Phase 1h gate is designed to catch. Future arcs touching `NEXT_PUBLIC_*` should sequence: env var → redeploy → bundle grep verify.
  - **`vercel domains inspect <subdomain>` reports parent registration, not project attachment.** The inspect command for `api.rentthisapp.com` returned info about the parent `rentthisapp.com` registration; it does not show which Vercel project owns the subdomain. The authoritative source for project attachment is `mcp__claude_ai_Vercel__get_project` per project id (showing the `domains` array). Use both: inspect for DNS/cert health, get_project for explicit-attachment ownership.
  - **Stripe webhook edit-in-place vs create-new.** Every Stripe webhook endpoint has its own `whsec_*`. The current API verifies against a single `STRIPE_WEBHOOK_SECRET` env var (single-reader at `stripe.service.ts:384`). Edit-in-place preserves the secret and is the only safe move for a host-only URL change. Create-new requires either an env-var rotation (and redeploy) or dual-secret verification code. Both options remain durable references for the future Stripe Live webhook setup arc.
  - **Vercel cert reuse on existing wildcard.** Adding an explicit `api.rentthisapp.com` to a project that doesn't already own the wildcard does NOT trigger a separate ACM cert request — Vercel serves the existing wildcard cert from the team's cert pool. Functionally identical, no renewal cycle change.
- **Audit trail.** `docs/audits/2026-05-05-arcN-api-domain-cutover-plan.md` (Phase 0 audit + execution plan with phase-gated structure). Closure footnote appended in this commit recording the actual SHAs and deploy ids landed.
- **Manual TODO surfaced for Anthony (NOT in this commit).** Remove the old `https://serviceos-api.vercel.app/auth/google/callback` redirect URI from the ServiceOS OAuth client in Google Cloud Console. Eligible to remove now that one full smoke pass succeeded. Manual UI action.

### 2026-05-04 (Project board reconciliation arc closed)

- **Phase 0 dump** found 51 board items with 0 missing-issue tracking gaps; main drift was stale Backlog status (cards whose blockers had shipped weeks earlier and were never re-categorized).
- **Phase 1 plan** answered 6 open questions:
  - Arc-level cards, not 1-card-per-PR (rebrand stack #81–#84 = one card; arcL #85+#86 = one card).
  - Minimal-touch on already-correct cards (no body footers on #28 / #77).
  - `Pre-launch polish` milestone created instead of stretching `Multi-tenant readiness` (which means "launch blocker", not "polish").
  - #62 "Tenant slug shortening" stays in Backlog (vanity slug tooling, not arcL's suffix removal).
  - `In Progress` is optional for short solo-dev arcs (Backlog → Done is acceptable).
  - Field-vs-label mismatch resolution policy: project field wins; label gets corrected to match field.
- **Phase 2 mutations** (executed 2026-05-04):
  - Created milestone `Pre-launch polish` (#6).
  - Created retroactive Done card for arcL (issue #87, project item `PVTI_lAHOAZbXz84BWRGTzgrzlq0`, milestone `Pre-launch polish`).
  - Created retroactive Done card for rebrand stack (issue #88, project item `PVTI_lAHOAZbXz84BWRGTzgrzmt8`, milestone `Pre-launch polish`).
  - Flipped #29 `[PR-C2]` Status: Backlog → Ready and removed `status:blocked` label (PR-C2-pre shipped via PR #67 on 2026-05-01).
  - Appended body footer to #29 noting unblock context.
- **Lessons captured in plan amendments:**
  - **§1.4 — write-scope precondition gate**: `gh project item-edit` and `gh project item-add` need the `project` write scope, not just `read:project`. Without it, Phase 2 fails mid-execution at the first project mutation, leaving milestone + first issue partially created. Fail-closed gate added before any mutation.
  - **§5.6 — label-set verification**: sort labels before comparison so `gh issue view --json` non-deterministic ordering doesn't surface as false drift.
  - **§6.3 / §6.4 / §6.5 — GitHub Projects auto-close-on-Done**: setting Status=Done via `gh project item-edit` triggers the project's built-in workflow that closes the linked issue (`state: closed, state_reason: completed`). Treat as expected behavior, not drift; the closed-at timestamp is a useful durable completed-at marker on each issue.
- **Audit trail:**
  - `docs/audits/2026-05-04-project-board-state-dump.md` (Phase 0)
  - `docs/audits/2026-05-04-project-board-phase1-plan.md` (Phase 1)
  - `docs/audits/2026-05-04-project-board-phase2-execution-plan.md` (Phase 2 plan with §1.4, §5.6, §6.5 amendments)
- **Board state delta:** 51 → 53 items; 5 → 6 milestones; status counts: Backlog 46 → 45, Ready 1 → 2, Done 2 → 4, Audit Pending 2 → 2.
- **Closing rule landed in CLAUDE.md** under new "Arc closure checklist" section: "Update the project board: close the arc-level card on completion, create new cards for any follow-ups surfaced during the arc, and move in-flight cards to the correct status column. Card hygiene is part of arc closure, not optional."

### 2026-05-04 (arcL closed — tenant slug shortened)
- Tenant slug shortened on production tenant `822481be` (Rent This Dumpster): `rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster`
- Phase 1a code merged: PR #85, squash commit `8ca250c`
- Phase 1b SQL run by Anthony in Supabase SQL editor (project `voczrzbdukgdrirmlgfw`) on 2026-05-05 01:29:01 UTC; preflight + UPDATE + postflight all green
- Phase 1c API redeploy: deploy id `dpl_2yeDZe5ocTc6AuJz5VNaeKALAaMK` (Sentry release pinned to `8ca250c`)
- Verification: new subdomain `rent-this-dumpster.rentthisapp.com` returns 200 with correct tenant payload; old subdomain returns Next.js 404 page; `/public/tenant/rent-this-dumpster` returns 200, `/public/tenant/rent-this-dumpster-mnbxs4jm` returns 404
- Audit record: `arcL-phase0-audit-report.md` (verdict C — code-change-first)
- Item removed from § 8 deferred backlog

### 2026-04-30 (Day 3 wrap, this entry — initial creation)
- Initial creation of arc-state.md
- 10 PRs shipped in PR-C arc (#13–#22)
- 5 audit blockers locked: C-1 (closed PR #20), C-2 (closed PR #21), C-3 (pending PR-C2), D-1..D-5 (D-2 deferred, others pending)
- Day 4 morning plan: ship docs/arc-state.md (this), docs/runbooks/, docs/decisions/, docs/feature-inventory.md, GitHub Issues + Projects setup, then PR-C2-pre
- Pre-launch blocker filed: username/password auth for non-email users (drivers, office staff) — added to Multi-tenant readiness milestone
- Next: PR-C2-pre implementation (after Day 4 setup completes)
