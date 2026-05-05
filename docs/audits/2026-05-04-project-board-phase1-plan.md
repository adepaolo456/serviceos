---
title: ServiceOS Project Board — Phase 1 Reconciliation Plan
phase: 1 (plan only — NO mutations)
date: 2026-05-04
project: ServiceOS Roadmap (#1, owner adepaolo456)
project_id: PVT_kwHOAZbXz84BWRGT
predecessor: docs/audits/2026-05-04-project-board-state-dump.md
mutations_in_this_doc: none
files_written: docs/audits/2026-05-04-project-board-phase1-plan.md (this file only)
---

# Phase 1 — Project board reconciliation plan

> This document **plans** the Phase 1 mutations. It does **not** execute them.
> No board card has been touched. No issue has been edited. No commit / push.
>
> Phase 2 (execution) waits on Anthony approving specific items in this plan
> per the "Definitely safe" vs "Needs confirmation" buckets at the bottom.

## 0. Inputs

- Phase 0 dump: `docs/audits/2026-05-04-project-board-state-dump.md` (51 items, status distribution, label-mirrored field values).
- Anthony's answers to Phase 0 open questions:
  - **Q1**: #62 = future custom/vanity slug tooling, NOT arcL. Keep #62 in Backlog.
  - **Q2**: arc-level cards, not per-PR cards. arcL = one card; rebrand stack = one card.
  - **Q3**: backfill missing milestones only when touching a card for another reason.
  - **Q4**: run a GraphQL preflight before any mutation to confirm true field values vs label mirrors.
  - **Q5**: standard kanban — Backlog (intended), Ready (scoped, no blockers, today-pickable), In Progress (active or paused), Done (shipped).
  - **Q6**: short solo-dev arcs may skip In Progress.

## 1. GraphQL preflight (read-only, runs before any mutation)

### 1a. Why

`gh project item-list --format json` doesn't surface per-item custom-field
values. Phase 0 used the issue **labels** as a proxy (`priority:P0`,
`arc:Phase-2`, `status:blocked`, …). If labels and project fields are out of
sync, mutations based only on labels can land in the wrong place.

The preflight settles that: it pulls the **actual** project field values
(Status, Priority, Effort, Audit Required, Arc, Type, Impact,
Bake-Window Safe) for every item and compares against labels.

### 1b. The query

Run via `gh api graphql -f query='…' --paginate` (no mutation, only read).

```graphql
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue { number title state url
              labels(first: 30) { nodes { name } }
              milestone { title } }
            ... on PullRequest { number title state url }
            ... on DraftIssue { title }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                name
                field { ... on ProjectV2SingleSelectField { id name } }
              }
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldMilestoneValue {
                milestone { title }
                field { ... on ProjectV2Field { id name } }
              }
            }
          }
        }
      }
    }
  }
}
```

**Variables:** `projectId = PVT_kwHOAZbXz84BWRGT`.

**Pagination:** 51 items < 100 page size, so a single page; `--paginate` is
defense-in-depth.

### 1c. Expected output shape

For each of the 51 items:

```jsonc
{
  "id": "PVTI_…",
  "content": { "number": 27, "title": "[Pre-launch] Username/password…",
                "labels": ["arc:Phase-2","type:feature","priority:P0",…],
                "milestone": "Multi-tenant readiness" },
  "fieldValues": [
    { "field": "Status",          "value": "Backlog" },
    { "field": "Priority",        "value": "P0" },
    { "field": "Effort",          "value": null },
    { "field": "Audit Required",  "value": null },
    { "field": "Arc",             "value": "Phase-2" },
    { "field": "Type",            "value": "new-feature" },
    { "field": "Impact",          "value": "trust" },
    { "field": "Bake-Window Safe","value": null },
    { "field": "Title",           "value": "[Pre-launch] Username/…" }
  ]
}
```

### 1d. What the preflight gates

After running the query, build a label-vs-field comparison report:

| Item | Label `priority:*` | Field `Priority` | Mismatch? |
|---|---|---|---|
| #27 | P0 | P0 | no |
| (etc.) |  |  |  |

Same for Arc, Type, Impact. If **any** mismatch is found, surface them and
**pause Phase 2** for Anthony to declare the truth source per field
(probably "field wins, label is a UI mirror"). If no mismatch, proceed
with Phase 2 mutations as planned below.

The preflight produces no mutations. It writes its findings to a temp
file (`/tmp/board-fieldvalues.json`) and a one-page diff summary in the
session for Anthony to read.

---

## 2. Per-card proposed actions

> **Anthony's Q2/Q3 reading:** only mutate cards that have a real reason to
> change. Don't churn Backlog items just because their milestone is unset
> — only set the milestone if you're already touching the card.

### 2a. Status drift → status change proposed

#### #29 — `[PR-C2] Sites 3 + 4 webhook bypass replacements + Site 4 internal guard`

| Field | Now | Proposed | Reason |
|---|---|---|---|
| Status | **Backlog** | **Ready** | PR-C2 was blocked on PR-C2-pre (= #28). #28 is Done (PR #67 merged 2026-05-01). **PR-C2 is now unblocked.** Per Q5 ("Ready = scoped, no blockers, today-pickable"), this fits. |
| Label `status:blocked` | present | **remove** | The blocker (PR-C2-pre) shipped 4 days ago. Stale. |
| Milestone | PR-C arc | (no change) | Already correct. |
| Body update | — | **append** a one-liner: `Unblocked 2026-05-01 by PR #67 (PR-C2-pre, closed #28). Spec lives in PR #22 audit doc.` |

**Bucket:** Definitely safe (verifiable from arc-state.md § 5 "From PR #22"
locked decisions D-3..D-5 plus PR #67 merge record).

#### Other status-blocked cards — verify, no change

| # | Title | status:blocked? | Verdict |
|---|---|---|---|
| #30 | [PR-C1d] Pessimistic invoice-row lock | yes | Blocker = PR-C2 (#29). #29 still Backlog→Ready. **Still blocked.** No change. |
| #33 | account.updated tenant resolution | yes | Deferred per arc-state.md § 6: "re-evaluate if Connect usage grows." Still blocked. No change. |
| #52 | Twilio A2P 10DLC + upgrade decision | yes | External Twilio decision. Still blocked. No change. |
| #63 | Google OAuth tenant selector UI | yes | Blocked on tenant 2 onboarding. No change. |
| #66 | [Tooling] Trial Superpowers (obra) | yes | Blocked on RentThis MVP. No change. |
| #69 | Add Stripe event-id dedup to SubscriptionsService.handleWebhook | yes | Blocked on PR-C2 (#29) shipping the dedup pattern. **Still blocked** even after #29 moves to Ready. No change. |

### 2b. Already-correct status — no-op, listed for completeness

| # | Status | Verdict |
|---|---|---|
| #28 | Done | Closed by PR #67. Correct. |
| #77 | Done | Closed by PR #79. Correct. |
| #71 | Ready | Vercel CLI upgrade is one global-install command, no blockers. Per Q5, correct. |
| #72 | Audit Pending | Product-decision pending. Correct. |
| #73 | Audit Pending | Refactor pending audit. Correct. |
| All 46 other Backlog | Backlog | Real future work, no PR has touched them, no blockers cleared. Correct. |

### 2c. Body-link enrichment (optional, per Q2 "PRs linked in card bodies for traceability")

When touching a card, add a brief footer linking the relevant PR(s) and audit
record(s) so the card is self-explanatory without arc-state.md.

| # | Touch reason | Body footer to add |
|---|---|---|
| #28 | already Done; add footer | `Closed via PR #67 (2026-05-01). Audit: arc-state.md § 5 D-1..D-5. Migration: stripe_events table.` |
| #77 | already Done; add footer | `Closed via PR #79 (2026-05-03). Fix: chain-first rental-days resolution in invoice email summary.` |
| #29 | status flip; add footer | (footer text already proposed above in §2a) |

**Bucket:** Body footers are non-state-changing markdown appends. Definitely
safe but optional — if Anthony prefers minimal edits, skip these.

### 2d. Cards NOT to touch

Per Anthony's direction Q1 + Q3 + "leave future backlog items in Backlog":

- **#62 Tenant slug shortening** — represents future custom/vanity slug
  tooling (e.g. admin-set `rentthis`), not arcL's suffix removal.
  Stays in Backlog. **Do not** mark Done. **Do not** link arcL PRs to it.
- All 46 Backlog items not listed in §2a — no PR has shipped, no blocker
  cleared, no reason to churn.
- Milestone-backfill on the 7 unmilestoned Backlog items (#68, #70, #74,
  #75, #76, #78, plus #69 listed in PR-C arc): **skip in this pass.**
  Q3 says backfill only when *already touching* the card; we are not
  touching these for any other reason in Phase 1.

---

## 3. New arc-level cards to create

Per Q2 — multi-PR arcs get one logical card; the rebrand stack and arcL
both fit. Plus arcK (the dead-tenant audit) was a no-op investigation — it
*could* be a card but adds nothing the audit report doesn't already
capture. Recommendation below treats arcK as optional.

### 3a. arcL — Tenant slug shortening (`mnbxs4jm` → `rent-this-dumpster`)

| Field | Value |
|---|---|
| Status | **Done** (created retroactively) |
| Title | `arcL — shorten tenant slug (rent-this-dumpster-mnbxs4jm → rent-this-dumpster)` |
| Repository | `adepaolo456/serviceos` |
| Type (project field) | chore |
| Arc (project field) | ops |
| Priority | P2 |
| Impact | single-tenant |
| Audit Required | Done |
| Bake-Window Safe | Yes |
| Milestone | (none — was a side-quest, not in any active milestone bucket) |
| Body | (see template below) |

**Body template:**

```markdown
**arcL — Tenant slug shortening**

Production tenant `822481be` (Rent This Dumpster) slug shortened from
`rent-this-dumpster-mnbxs4jm` → `rent-this-dumpster`.

## Phases

- **Phase 0 audit:** `arcL-phase0-audit-report.md` (verdict C — code change required first)
- **Phase 1a code:** PR #85 (squash `8ca250c`, merged 2026-05-04)
- **Phase 1b SQL:** Manual Supabase SQL (project `voczrzbdukgdrirmlgfw`), run 2026-05-05 01:29:01 UTC; preflight + `UPDATE tenants SET slug='rent-this-dumpster' …` + postflight all green
- **Phase 1c deploy:** `dpl_2yeDZe5ocTc6AuJz5VNaeKALAaMK` (Sentry release pinned to `8ca250c`)
- **Phase 1d docs closure:** PR #86 (squash `a83b874`, merged 2026-05-05)

## Verification

- `https://rent-this-dumpster.rentthisapp.com/` → 200, correct tenant payload
- `https://rent-this-dumpster-mnbxs4jm.rentthisapp.com/` → Next.js 404 page
- `/public/tenant/rent-this-dumpster` → 200; `/public/tenant/rent-this-dumpster-mnbxs4jm` → 404

## Out of scope

Future custom/vanity slug tooling (admin-set short slugs like `rentthis`)
remains tracked separately in #62.
```

**Open question for Anthony:** create this issue in `adepaolo456/serviceos`
and add to the project as Done? Or — since arc-state.md § 11 already
records arcL closure canonically — leave the board without an arcL card?

**Recommendation:** create it. It gives the board parity with arc-state.md
and surfaces the closure visually (Done column) for anyone scanning the
board without reading the docs.

### 3b. Rebrand stack — ServiceOS → RentThisApp customer-facing

| Field | Value |
|---|---|
| Status | **Done** (created retroactively) |
| Title | `Rebrand customer-facing strings + API key prefix (ServiceOS → RentThisApp / rta_live_)` |
| Repository | `adepaolo456/serviceos` |
| Type | chore |
| Arc | ops |
| Priority | P1 |
| Impact | trust |
| Audit Required | No |
| Bake-Window Safe | Yes |
| Milestone | (none — pre-launch polish, doesn't fit existing milestones cleanly) |
| Body | (see template) |

**Body template:**

```markdown
**Pre-launch rebrand: customer-facing strings + API key prefix**

Internal naming stays `serviceos` per CLAUDE.md "Brand split" rule.
Customer-facing surfaces moved to `rentthisapp` / `rta_live_`.

## PRs

- #81 (`083df95`, 2026-05-04) — chore(web,api): rebrand customer-facing static text from ServiceOS to RentThisApp
- #82 (`7812bdc`, 2026-05-04) — chore(web): replace fabricated webhook URL with coming-soon disabled state
- #83 (`696b960`, 2026-05-04) — fix(settings): unify API key prefix to rta_live_ (PR-2)
- #84 (`e110d2d`, 2026-05-04) — ci: always run api unit tests on PRs (replace PR #80 workaround)

## Out of scope

- Internal `serviceos` references (code, repo, schemas, Vercel project names) intentionally untouched per CLAUDE.md.
```

### 3c. arcK — Dead-tenant cleanup audit (`ef0aa720` no-op)

| Field | Value |
|---|---|
| Status | **Done** |
| Title | `arcK — dead-tenant cleanup audit (ef0aa720, no-op)` |
| Type | audit |
| Arc | ops |
| Priority | P3 |
| Impact | internal-only |
| Audit Required | Done |
| Bake-Window Safe | Yes |
| Body | reference `arcK-phase0-audit-report.md` (verdict D — target tenant doesn't exist; no action taken). |

**Recommendation:** **OPTIONAL.** arcK was an audit that returned "nothing
to do." A board card for it adds little. If you skip arcK, the audit
report file alone is the durable record. If you create it, do so for
parity with arcL.

### 3d. Cards NOT to create

Per Q2 — single-PR fixes that are standalone work items can have their
own card, but routine PRs do **not** get retroactive cards.

| PR | Could it be a card? | Recommendation |
|---|---|---|
| #80 (Repomix tooling) | Could be | **Skip.** Closely related to #65 (Gemini CLI tooling); if needed, append a body note to #65 or open a single Phase 2 follow-up. Not worth a retroactive card. |
| #79 (rental-days) | Already linked | No new card — closes #77. |
| #67 (PR-C2-pre) | Already linked | No new card — closes #28. |
| #1–#26 (pre-board) | n/a | The board's lowest item number is #27, so PRs #1–#26 predate the board's existence. **Don't backfill.** |

---

## 4. Definitely safe vs Needs confirmation

### 4a. Definitely safe to apply (mechanical, fully derivable from existing canonical sources)

| # | Action | Source of truth |
|---|---|---|
| #29 | Status: Backlog → **Ready** | arc-state.md § 5 D-3..D-5 + PR #67 merge record |
| #29 | Remove `status:blocked` label | Same (blocker shipped) |
| #29 | Append body footer linking PR #67 + audit doc | arc-state.md § 5 |

That's the entire "definitely safe" bucket. Three changes on a single card,
all directly traceable.

### 4b. Needs Anthony's explicit yes/no before applying

| Action | Question |
|---|---|
| Create arcL card (Done) | Q2 says "arc-level cards, not per-PR cards" — but doesn't *require* retroactive cards for closed arcs. Yes/No? |
| Create rebrand-stack card (Done) | Same Q2 ambiguity. Yes/No? |
| Create arcK card (Done) | Optional per §3c. Yes/No? |
| Append body footers to #28 and #77 (already Done) | Anthony may prefer minimal touches on already-correct cards. Yes/No? |
| Backfill any milestones at all in this pass | Q3 says "backfill *only when touching for status*"; the only card we're touching for status (#29) is already milestoned. So this pass would set zero new milestones. Confirm that's intentional? |
| Treat field values as truth if preflight surfaces label-vs-field mismatches | Q4 says "preflight before mutation." Confirm: if mismatch found, field wins, label gets relabeled in Phase 2? Or: stop and ask each time? |

### 4c. Out of scope (NOT touching, per Phase 0 / answers)

- #62 Tenant slug shortening — stays Backlog (Q1).
- All 45 other Backlog items not listed above — no churn.
- Per-PR card creation for routine PRs (Q2).
- Standalone "fix milestones" pass (Q3).
- "In Progress" backfill for short solo-dev arcs (Q6).
- Anything outside the project board (CLAUDE.md edits, docs/runbooks/, ADRs, etc. — not in scope for this arc).

---

## 5. Phase 2 execution sketch (for Anthony's reference, NOT to be run yet)

Once Anthony approves specific items from §4a / §4b, Phase 2 will:

1. Re-run §1 GraphQL preflight, save to `/tmp/board-fieldvalues.json`,
   diff against labels, **stop** if any mismatch.
2. Apply approved §4a actions via:
   - `gh project item-edit` (status field by option-id, not name)
   - `gh issue edit #29 --remove-label status:blocked --body-file <tmpfile>`
3. For each approved §4b card-creation:
   - `gh issue create --title … --body-file <tmpfile> --label …`
   - `gh project item-add 1 --owner adepaolo456 --url <issue-url>`
   - Set status field via `gh project item-edit` (Done option-id `98236657`)
   - Set Type / Arc / Priority / Impact / Audit Required / Bake-Window Safe
     fields by option-id
4. Re-query the board and produce a post-mutation diff report.
5. Stop. Do not commit. Do not push. Anthony reviews the diff.

Phase 2 will be a separate prompt with explicit approval per item.

---

## 6. Compliance with the original audit charter

- [x] No board mutations performed in this plan
- [x] No card creates / edits / status changes / label changes / body updates
- [x] No commit / push
- [x] Single repo file written: `docs/audits/2026-05-04-project-board-phase1-plan.md` (this file)
- [x] GraphQL preflight described, not yet run
- [x] Per-card actions organized by arc/area
- [x] Arc-level card list provided (arcL, rebrand stack, optional arcK)
- [x] "Definitely safe" vs "Needs confirmation" split made explicit
- [x] STOP — awaiting Anthony's per-item approvals before any Phase 2 execution
