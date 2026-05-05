---
title: ServiceOS Project Board State Dump
phase: 0 (read-only)
date: 2026-05-04
project: ServiceOS Roadmap (#1, owner adepaolo456, user-scoped)
project_url: https://github.com/users/adepaolo456/projects/1
sources:
  - gh project list --owner adepaolo456 --format json
  - gh project field-list 1 --owner adepaolo456 --format json --limit 50
  - gh project item-list 1 --owner adepaolo456 --format json --limit 200
  - gh issue list --repo adepaolo456/serviceos --state open --limit 200 …
  - gh issue list --repo adepaolo456/serviceos --state closed --limit 50 …
  - gh pr list --repo adepaolo456/serviceos --state merged --limit 30 …
mutations: none
files_written: docs/audits/2026-05-04-project-board-state-dump.md (this report only)
---

# ServiceOS Project Board State Dump

Read-only Phase 0 audit of the GitHub Projects board against repo issues
and recently merged PRs. No board / issue / PR mutations performed.

## Board metadata

| Field | Value |
|---|---|
| Project number | `1` |
| Title | **ServiceOS Roadmap** |
| URL | https://github.com/users/adepaolo456/projects/1 |
| Owner | `adepaolo456` (user-scoped, not org-owned) |
| Visibility | private (`public: false`) |
| Total items | 51 (all `Issue` type — 0 PRs, 0 draft items) |
| Total custom fields | 17 |
| Closed | no (project is open/active) |

### Status column ordering

`Backlog` → `In Progress` → `Done` → `Audit Pending` → `Ready` → `Review`

### Status distribution

| Status | Count |
|---|---|
| Backlog | 46 |
| Audit Pending | 2 |
| Done | 2 |
| Ready | 1 |
| In Progress | 0 |
| Review | 0 |

### Custom fields (17)

| Name | Type | Options |
|---|---|---|
| Title | builtin text | — |
| Assignees | builtin | — |
| Status | single-select | Backlog, In Progress, Done, Audit Pending, Ready, Review |
| Labels | builtin | — |
| Linked pull requests | builtin | — |
| Milestone | builtin | — |
| Repository | builtin | — |
| Reviewers | builtin | — |
| Parent issue | builtin | — |
| Sub-issues progress | builtin | — |
| **Priority** | single-select | P0, P1, P2, P3 |
| **Effort** | single-select | XS, S, M, L, XL |
| **Audit Required** | single-select | Yes, No, Done |
| **Arc** | single-select | GTM, PR-C, Phase-2, Phase-3, Phase-4-AI, infra, ops, frontend |
| **Type** | single-select | bug-from-prod, bug-from-review, audit, doc, chore, refactor, tech-debt, policy, product-decision, new-feature |
| **Impact** | single-select | revenue, trust, all-tenants, single-tenant, internal-only |
| **Bake-Window Safe** | single-select | Yes, No |

> **Note on field-value extraction:** `gh project item-list --format json` does
> not surface custom-field values per-item. Below, the Priority / Arc / Type /
> Impact / status:blocked / status:audit-pending values come from the **issue
> labels**, which mirror the project fields (e.g. `priority:P0`, `arc:Phase-2`,
> `impact:trust`). If you want a true field-value dump (vs label mirror), I'd
> need to run a follow-up GraphQL query against `node(id) { ... on
> ProjectV2Item { fieldValues } }`.

### Milestone distribution

| Milestone | Items |
|---|---|
| Multi-tenant readiness | 16 |
| Phase 4 AI | 11 |
| Phase 2 features | 6 |
| PR-C arc | 4 |
| Production SMS | 3 |
| **(no milestone)** | **11** |

11 items are not assigned to any milestone — flagged below as a hygiene gap.

---

## Board items by status column

### Status: Done (2)

| # | Milestone | Title | Closed-via |
|---|---|---|---|
| #28 | PR-C arc | [PR-C2-pre] stripe_events migration + entity + entry-point dedup INSERT | PR #67 (merged 2026-05-01) |
| #77 | (none) | Sweep `\|\| 14` rental-days fallbacks for pricing correctness | PR #79 (merged 2026-05-03) |

Both correctly tracked — closing PRs explicitly referenced these issues via
`Closes #N`, which auto-moved them to Done.

### Status: Ready (1)

| # | Milestone | Labels | Title |
|---|---|---|---|
| #71 | (none) | `arc:infra type:chore priority:P3 impact:internal-only` | Upgrade local Vercel CLI from 50.37.3 to latest stable |

> Side observation surfaced from the arcL Phase 1c deploy: the local CLI is
> still 50.37.3 (53.1.1 is current). Not blocking; can stay in Ready.

### Status: Audit Pending (2)

| # | Milestone | Labels | Title |
|---|---|---|---|
| #72 | (none) | `arc:Phase-2 status:audit-pending impact:internal-only type:product-decision` | Decide product scope for dormant `jobs.placement_lat` / `placement_lng` fields |
| #73 | (none) | `status:audit-pending impact:internal-only type:refactor priority:P3` | Migrate dashboard customer pickers to shared `useCustomerAutocomplete` hook |

### Status: In Progress (0)

Nothing currently `In Progress`. The recent arcL work (PRs #85, #86) and
the rebrand stack (PRs #81–#84) all moved through without a corresponding
board card sitting in `In Progress` — see "PR/issue linkage gaps" below.

### Status: Review (0)

Empty.

### Status: Backlog (46)

Grouped by milestone, sorted by milestone then issue number.

#### Milestone: Multi-tenant readiness (16 items, all Backlog except those above)

| # | Priority | Labels | Title |
|---|---|---|---|
| #27 | **P0** | `arc:Phase-2 type:feature impact:all-tenants impact:trust` | [Pre-launch] Username/password authentication for non-email users (drivers, office staff) |
| #31 | P2 | `type:doc impact:internal-only` | Fix CLAUDE.md line 38 stale rule (synchronize: true → synchronize: isTest) |
| #32 | P2 | `arc:infra type:implementation` | stripe_events retention prune (D-2 follow-up) |
| #33 | P2 | `type:audit status:blocked` | account.updated tenant resolution (if dedup correctness becomes critical) |
| #34 | P2 | `type:doc impact:internal-only` | Sweep stale TenantGuard references across docs and CLAUDE.md |
| #53 | P1 | `arc:infra type:implementation impact:all-tenants` | Wildcard DNS config for rentthisapp.com |
| #54 | P2 | `arc:infra type:doc impact:all-tenants impact:trust` | RLS threat-model decision doc |
| #55 | P2 | `arc:infra type:audit impact:single-tenant` | Quotes RLS policy outlier review |
| #56 | P2 | `arc:infra type:audit impact:internal-only` | Optional FORCE ROW LEVEL SECURITY evaluation |
| #57 | P1 | `arc:infra type:feature impact:internal-only` | E2E testing infrastructure (Playwright) |
| #58 | P2 | `arc:ops type:fix impact:internal-only` | Customer autocomplete extraction |
| #59 | P1 | `arc:ops type:doc impact:all-tenants` | Second-tenant onboarding playbook |
| #62 | P2 | `arc:ops type:fix impact:single-tenant` | Tenant slug shortening |
| #63 | P1 | `arc:ops type:feature status:blocked impact:all-tenants` | Google OAuth tenant selector UI (when tenant 2 onboarded) |
| #65 | P2 | `arc:ops type:feature impact:internal-only` | [Tooling] Install Gemini CLI for >Claude-context queries |
| #66 | P2 | `arc:ops type:feature status:blocked impact:internal-only` | [Tooling] Trial Superpowers (obra) on RentThis MVP |

> **Drift candidate:** #62 "Tenant slug shortening" is still in Backlog
> despite arcL having shortened the tenant slug `rent-this-dumpster-mnbxs4jm`
> → `rent-this-dumpster` on 2026-05-04 (PR #85 + Phase 1b SQL + deploy
> `dpl_2yeDZe5ocTc6AuJz5VNaeKALAaMK`). The board card was never linked to PR
> #85 via `Closes #62`. If #62 represents the further shortening to something
> like `rentthis`, leave it; if it represents the shortening Anthony just
> closed, this is the most actionable drift item on the board. See "Open
> questions" below.

#### Milestone: PR-C arc (4 items, 1 Done above + 3 Backlog)

| # | Priority | Labels | Title |
|---|---|---|---|
| #29 | **P0** | `arc:PR-C type:implementation status:blocked` | [PR-C2] Sites 3 + 4 webhook bypass replacements + Site 4 internal guard |
| #30 | P1 | `arc:PR-C type:implementation status:blocked` | [PR-C1d] Pessimistic invoice-row lock for chargeInvoice / refundInvoice |
| #64 | P1 | `type:audit impact:revenue impact:trust` | [Audit pending] subscriptions.service.ts SSoT arc |

#### Milestone: Production SMS (3 items, all Backlog)

| # | Priority | Labels | Title |
|---|---|---|---|
| #52 | P1 | `arc:infra type:implementation status:blocked impact:all-tenants` | Twilio A2P 10DLC + upgrade decision |
| #60 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Notification settings UI (per-event SMS/email toggles) |
| #61 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Driver branding (per-tenant SMS/email customization) |

#### Milestone: Phase 2 features (6 items, all Backlog)

| # | Priority | Labels | Title |
|---|---|---|---|
| #35 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Phase 2: E-sign integration |
| #36 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Phase 2: Permits module |
| #37 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Phase 2: Accounting integrations (QuickBooks, Xero) |
| #38 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Phase 2: Advanced reports module |
| #39 | P2 | `arc:Phase-2 type:feature impact:all-tenants` | Phase 2: GPS / fleet management |
| #40 | P2 | `arc:Phase-2 type:feature impact:internal-only` | Phase 2: Admin tooling |

#### Milestone: Phase 4 AI (11 items, all Backlog)

| # | Priority | Labels | Title |
|---|---|---|---|
| #41 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Route optimizer |
| #42 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Smart SMS auto-responder |
| #43 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Voice booking |
| #44 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Revenue forecasting |
| #45 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Demand heatmaps |
| #46 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Cost-per-job calculations |
| #47 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: OCR for dump tickets |
| #48 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Predictive scheduling |
| #49 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: AI dispatch assistant |
| #50 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Photo damage detection |
| #51 | P2 | `arc:Phase-4-AI type:feature impact:all-tenants` | Phase 4 AI: Voice notes |

#### No milestone (7 Backlog items + 1 Ready + 2 Audit Pending = 10 of 11 unassigned)

| # | Status | Priority | Labels | Title |
|---|---|---|---|---|
| #68 | Backlog | P1 | `arc:infra type:bug-from-review impact:all-tenants impact:trust` | [Security] Require STRIPE_WEBHOOK_SECRET for /stripe/webhook; remove unsigned JSON.parse fallback |
| #69 | Backlog | P2 | `arc:PR-C status:blocked impact:revenue type:tech-debt` | Add Stripe event-id dedup to SubscriptionsService.handleWebhook |
| #70 | Backlog | P2 | `arc:infra status:audit-pending impact:internal-only type:policy` | Define policy for admin bypasses on `main` branch protection |
| #71 | Ready | P3 | `arc:infra type:chore impact:internal-only` | Upgrade local Vercel CLI from 50.37.3 to latest stable |
| #72 | Audit Pending | (none) | `arc:Phase-2 status:audit-pending impact:internal-only type:product-decision` | Decide product scope for dormant `jobs.placement_lat` / `placement_lng` fields |
| #73 | Audit Pending | P3 | `status:audit-pending impact:internal-only type:refactor` | Migrate dashboard customer pickers to shared `useCustomerAutocomplete` hook |
| #74 | Backlog | P3 | `arc:infra type:policy` | Periodically review session-closeout protocol for staleness |
| #75 | Backlog | (none) | `type:bug-from-review impact:all-tenants` | RBAC review on POST /bookings/create-with-booking |
| #76 | Backlog | (none) | `impact:single-tenant` | Investigate X-1021 missing pricing snapshot |
| #78 | Backlog | (none) | `type:tech-debt` | Cosmetic indentation cleanup in orchestration.service.ts delivery branch |

> **Note:** the 77/Done item is also without a milestone (showing as "(none)" in
> the Done section above), making the total of "no milestone" items = 11.

---

## Open issues NOT on board

**None.**

Cross-reference of all 49 open repo issues vs the 51 board items:

```
comm -23 <(open_issue_numbers | sort -n) <(board_issue_numbers | sort -n)
→ (empty)
```

All 49 open issues are on the board. No tracking gaps on the open-issue side.

---

## Recently closed issues NOT on board

**None.**

The repo has only 2 recently closed issues; both are on the board with status `Done`.

| # | Closed at | Title | Board status |
|---|---|---|---|
| #28 | 2026-05-01 | [PR-C2-pre] stripe_events migration + entity + entry-point dedup INSERT | Done ✓ |
| #77 | 2026-05-03 | Sweep `\|\| 14` rental-days fallbacks for pricing correctness | Done ✓ |

No completion gaps.

---

## Recently merged PRs and their issue closures

Last 30 merged PRs (`gh pr list --state merged --limit 30`). Linkage column
shows what each PR closed via `closingIssuesReferences`.

| PR | Merged at | Title (truncated) | Closes issue |
|---|---|---|---|
| #86 | 2026-05-05 | docs(arcL): mark arc closed | — |
| #85 | 2026-05-05 | arcL: shorten tenant slug rent-this-dumpster-mnbxs4jm → rent-this-dumpster | — |
| #84 | 2026-05-04 | ci: always run api unit tests on PRs (fix web PR block) | — |
| #83 | 2026-05-04 | fix(settings): unify API key prefix to rta_live_ (PR-2) | — |
| #82 | 2026-05-04 | chore(web): replace fabricated webhook URL with coming-soon disabled state | — |
| #81 | 2026-05-04 | chore(web,api): rebrand customer-facing static text from ServiceOS to RentThisApp | — |
| #80 | 2026-05-03 | chore: add Repomix as root tooling | — |
| #79 | 2026-05-03 | fix(invoice/email): chain-first rental-days resolution in summary text | **#77** |
| #67 | 2026-05-01 | fix(stripe): add stripe_events table + entry-point dedup (PR-C2-pre) | **#28** |
| #26 | 2026-05-01 | docs(features): add feature-inventory.md | — |
| #25 | 2026-05-01 | docs(decisions): add ADR convention + 3 starter ADRs | — |
| #24 | 2026-05-01 | docs(runbooks): add incident response + database recovery runbooks | — |
| #23 | 2026-05-01 | docs(state): add arc-state.md tracker | — |
| #22 | 2026-04-30 | docs(audits): add PR-C2 webhook dedup audit record | — |
| #21 | 2026-04-30 | fix(stripe): PR-C1c replace sync bypass writes (Sites 1 + 2) with reconcileBalance | — |
| #20 | 2026-04-30 | fix(billing): PR-C1c-pre reconcileBalance math fix + isFullyRefunded helper | — |
| #19 | 2026-04-30 | docs(audits): add reconcileBalance() bypass audit record | — |
| #18 | 2026-04-30 | docs(audits): PR-C1b Stripe idempotency audit | — |
| #17 | 2026-04-30 | fix(stripe): PR-C1b-1 idempotency keys for 4 P0 write sites | — |
| #16 | 2026-04-30 | fix(jobs): PR-C1a cancellation lock + autoCloseChainIfTerminal call | — |
| #15 | 2026-04-30 | docs(audits): PR-C1 autoCloseChainIfTerminal expansion audit | — |
| #14 | 2026-04-30 | docs(audits): PR-C1 ghost-active chain repair record | — |
| #13 | 2026-04-30 | docs(audits): PR-C audit final | — |
| #12 | 2026-04-30 | chore(hooks): fix hook path resolution + capture gh CLI followup | — |
| #11 | 2026-04-30 | feat(concurrency): close PR-B race surfaces 1 + 4 | — |
| #10 | 2026-04-30 | chore: add CLAUDE.md + subagents + PreToolUse hooks | — |
| #9 | 2026-04-29 | fix: catch unique violation on marketplace customer dedup race | — |
| #8 | 2026-04-29 | chore: remove legacyPaidWithoutPayment escape hatch | — |
| #7 | 2026-04-29 | fix: route MarketplaceService.accept() through JobsService.create | — |
| #6 | 2026-04-29 | fix: gate marketplace public endpoints behind enabled integration | — |

**2 of 30 PRs (6.7%) reference an issue via `Closes #N`.** The board's only
auto-Done movements (#28, #77) come from those two PRs.

---

## Board drift findings

> "Drift" = the board state disagrees with the underlying issue / PR state.
> Distinct from tracking gaps (issues not on board) and linkage gaps (PRs
> not closing issues).

### Confirmed drift

**None on the strict definition.**

Both closed issues (#28, #77) are correctly in `Done`. No issues are stuck
in `In Progress` while their PR has merged (because no PRs merged that
referenced board issues other than the two already moved to Done).

### Drift candidates (need Anthony's interpretation)

1. **#62 "Tenant slug shortening" is still in Backlog despite arcL having
   shortened the slug on 2026-05-04.** PR #85 / Phase 1b SQL / deploy
   `dpl_2yeDZe5ocTc6AuJz5VNaeKALAaMK` collectively executed the rename
   `rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster`. The card was never
   linked to that PR. Verdict depends on the card's intent:
   - If #62 was the arcL piece: **drift** — should be moved to Done with
     PR/SHA references.
   - If #62 represents the *further* shortening to something like `rentthis`
     (the original intent in pre-arcL `arc-state.md` / `feature-inventory.md`):
     **no drift** — leave in Backlog as future work.

2. **No `In Progress` movement for any of PRs #81–#86.** The rebrand stack
   (#81–84), arcL code (#85), and arcL docs (#86) shipped without any board
   card transitioning through `In Progress`. This is a **board hygiene gap**,
   not strictly drift, but it's why the user said "we've been completing
   pre-launch work without consistently updating the board."

3. **arcL has no board card.** PR #85 / arcL closure is recorded in
   `arc-state.md` § 11 and `feature-inventory.md` (per PR #86) but not as a
   board issue. Two interpretations:
   - The team policy is "arcs live in `arc-state.md`, not on the board." Then
     no action.
   - The team policy is "every shipped PR maps to a board card." Then a
     retroactive Done card should be added in the catch-up arc.

4. **The rebrand work (PRs #81–84, PR #2) has no board card.** Same
   interpretation question.

5. **#71 "Upgrade local Vercel CLI from 50.37.3 to latest stable" is in
   Ready.** During arcL Phase 1c the deploy succeeded with 50.37.3, so the
   item is not blocking. Could move back to Backlog if it's not actively
   queued, but "Ready" is also defensible.

### Linkage gaps (PRs that didn't close any issue) — 28 of 30 recent PRs

The dominant pattern is missing `Closes #N` linkage. This isn't drift in the
strict sense — it's a board-update-discipline gap. Notable PRs that
*could* have referenced backlog items:

| PR | What it did | Plausible board card |
|---|---|---|
| #85 | arcL slug rename | #62 (slug shortening) — see drift candidate #1 |
| #84 | CI: always run api tests on PRs | (no obvious board card) |
| #83 | unify API key prefix `rta_live_` | (no obvious board card) |
| #82 | webhook URL coming-soon | (no obvious board card) |
| #81 | rebrand customer-facing strings | (no obvious board card) |
| #80 | add Repomix root tooling | maybe #65 (Gemini-CLI tooling sibling) — different tool though |
| #79 | rental-days resolution | #77 ✓ already closed |
| #67 | stripe_events dedup | #28 ✓ already closed |
| #26..#10 | docs / audits / PR-C race fixes | mostly pre-board (board was created during this period — board's lowest item number is #27) |

The "pre-board" caveat matters: board card numbers start at #27, so PRs
#1–#26 predate the board's existence. They couldn't reference board cards
that didn't exist yet. That explains the heavy "—" run on #6–#26.

---

## Open questions for Anthony

1. **#62 "Tenant slug shortening" — already done by arcL, or is it the
   future further-shortening task?** Drives whether to move it to Done with
   PR #85 reference, or leave it in Backlog as a `rent-this-dumpster` →
   `rentthis` follow-up.

2. **Board policy: every shipped PR → a card?** Or do arcs (arc-state.md
   entries) substitute for cards? Affects whether the catch-up arc creates
   retroactive Done cards for PRs #80–#86 (and arguably the rebrand/PR-C
   stack).

3. **Items without a milestone** (11 of 51 = 22%):
   - All Done items are unmilestoned.
   - All Audit Pending and Ready items are unmilestoned.
   - 7 Backlog items are unmilestoned: #68, #69, #70, #74, #75, #76, #78.
   - Should the catch-up arc backfill milestones, or are these intentionally
     unbucketed because they're cross-cutting / one-off?

4. **Custom-field-value extraction.** The `gh project item-list --format
   json` API doesn't surface per-item custom-field values (Priority, Effort,
   Audit Required, Arc, Type, Impact, Bake-Window Safe). This report uses
   the issue **labels** as a mirror (`priority:P0`, `arc:Phase-2`, etc.).
   - If you want a true field-value-vs-label drift check, ask me to run a
     follow-up GraphQL query (still read-only).
   - If labels and fields are kept in sync by automation, this report is
     sufficient.

5. **#71 "Upgrade local Vercel CLI" is in `Ready` but unassigned and
   unmilestoned.** Is "Ready" being used to mean "queued for the next quiet
   moment" or "next thing to start"? Affects whether it stays in Ready or
   drops back to Backlog.

6. **`In Progress` is empty** while the conversation history shows arcK,
   arcL, the rebrand stack, etc. all worked through to merge. Is the
   convention to skip `In Progress` for short-lived solo-dev arcs, or has
   the column simply gone unused?

---

## Constraints honored

- [x] Read-only — no `gh project item-add/edit/delete/field-update`
- [x] No `gh issue create/close/edit/comment`
- [x] No `gh pr edit/close/comment`
- [x] No commits, no pushes
- [x] Single repo file written: `docs/audits/2026-05-04-project-board-state-dump.md` (this file)
- [x] gh `read:project` scope confirmed before any project queries

## Compliance with the original audit charter

- [x] gh CLI auth + `read:project` scope confirmed before queries
- [x] Single project board identified unambiguously (only one project under owner)
- [x] Board metadata + 17 fields + 6 status options dumped
- [x] All 51 items listed with status, milestone, label-mirrored field values
- [x] Open issues cross-referenced (49 → 49 on board, 0 missing)
- [x] Closed issues cross-referenced (2 → 2 on board with Done, 0 missing)
- [x] Last 30 merged PRs listed with `closingIssuesReferences`
- [x] Drift findings + linkage-gap findings surfaced
- [x] Open questions section captures all interpretive ambiguities
- [x] No mutations performed
