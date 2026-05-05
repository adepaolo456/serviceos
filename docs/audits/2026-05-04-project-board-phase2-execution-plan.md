---
title: ServiceOS Project Board — Phase 2 Execution Plan
phase: 2 (execution plan only — NO mutations until separate authorization)
date: 2026-05-04
project: ServiceOS Roadmap (#1, owner adepaolo456)
project_id: PVT_kwHOAZbXz84BWRGT
predecessors:
  - docs/audits/2026-05-04-project-board-state-dump.md (Phase 0)
  - docs/audits/2026-05-04-project-board-phase1-plan.md (Phase 1 plan)
mutations_in_this_doc: none
files_written: docs/audits/2026-05-04-project-board-phase2-execution-plan.md (this file only)
---

# Phase 2 — Project board execution plan

> This document is the **executable script** for the Phase 2 mutations
> that Anthony approved in the Phase 1 plan, plus the new "Pre-launch
> polish" milestone Anthony just authorized.
>
> **Nothing in this document has been executed.** Reading it makes no
> changes. Execution is gated on a separate "Phase 2 go" prompt from
> Anthony.

## §0 Approvals carried forward (from Phase 1 review)

| Item | Status |
|---|---|
| §1 GraphQL preflight | **APPROVED** + snapshot to `/tmp/board-fieldvalues-pre.json` |
| Mismatch resolution policy | **APPROVED** — project field wins; label gets corrected to match field, never reverse |
| §2a #29 — status flip, label removal, body footer | **APPROVED** |
| §3a arcL card | **APPROVED** — milestone: `Pre-launch polish` (new) |
| §3b Rebrand stack card | **APPROVED** — milestone: `Pre-launch polish` (new) |
| §3c arcK card | **DECLINED** — skip |
| §4b body footers on #28, #77 | **DECLINED** — skip |
| §4b milestone backfill on untouched cards | **DECLINED** — zero milestone backfills this pass |

## §0a Constants (verbatim from Phase 0 field-list dump — used by every command below)

```bash
PROJECT_ID="PVT_kwHOAZbXz84BWRGT"
PROJECT_NUMBER="1"
OWNER="adepaolo456"
REPO="adepaolo456/serviceos"

# Field IDs
FIELD_STATUS="PVTSSF_lAHOAZbXz84BWRGTzhRm0kM"
FIELD_PRIORITY="PVTSSF_lAHOAZbXz84BWRGTzhRrE4A"
FIELD_EFFORT="PVTSSF_lAHOAZbXz84BWRGTzhRrIig"
FIELD_AUDIT_REQUIRED="PVTSSF_lAHOAZbXz84BWRGTzhRrJAk"
FIELD_ARC="PVTSSF_lAHOAZbXz84BWRGTzhRrK7o"
FIELD_TYPE="PVTSSF_lAHOAZbXz84BWRGTzhRrNrY"
FIELD_IMPACT="PVTSSF_lAHOAZbXz84BWRGTzhRrOH4"
FIELD_BAKE_WINDOW_SAFE="PVTSSF_lAHOAZbXz84BWRGTzhRrOZA"

# Status options
OPT_STATUS_BACKLOG="f75ad846"
OPT_STATUS_IN_PROGRESS="47fc9ee4"
OPT_STATUS_DONE="98236657"
OPT_STATUS_AUDIT_PENDING="02dd0fef"
OPT_STATUS_READY="bf7f2056"
OPT_STATUS_REVIEW="8baeffbf"

# Priority options
OPT_PRIORITY_P0="22ccf174"
OPT_PRIORITY_P1="1ee8f6e4"
OPT_PRIORITY_P2="95aec89c"
OPT_PRIORITY_P3="e5b3cbf0"

# Audit Required options
OPT_AUDIT_YES="91ad32f1"
OPT_AUDIT_NO="b4879d1e"
OPT_AUDIT_DONE="87fcfe8f"

# Arc options
OPT_ARC_GTM="97832906"
OPT_ARC_PRC="5855c598"
OPT_ARC_PHASE2="513f81b6"
OPT_ARC_PHASE3="edacc1ac"
OPT_ARC_PHASE4AI="7120b2df"
OPT_ARC_INFRA="6c4e6631"
OPT_ARC_OPS="f027dd2f"
OPT_ARC_FRONTEND="9aa2f28f"

# Type options
OPT_TYPE_BUG_FROM_PROD="e56406f7"
OPT_TYPE_BUG_FROM_REVIEW="c0e64f7e"
OPT_TYPE_AUDIT="90438013"
OPT_TYPE_DOC="dee2c1d7"
OPT_TYPE_CHORE="3093d9f6"
OPT_TYPE_REFACTOR="56058010"
OPT_TYPE_TECH_DEBT="583af97c"
OPT_TYPE_POLICY="edd7f811"
OPT_TYPE_PRODUCT_DECISION="26c40a8f"
OPT_TYPE_NEW_FEATURE="59a54efd"

# Impact options
OPT_IMPACT_REVENUE="a11101a6"
OPT_IMPACT_TRUST="74ad90d6"
OPT_IMPACT_ALL_TENANTS="2141ab33"
OPT_IMPACT_SINGLE_TENANT="eee8fdd4"
OPT_IMPACT_INTERNAL_ONLY="1fb616bb"

# Bake-Window Safe options
OPT_BWS_YES="ced69349"
OPT_BWS_NO="b6c40849"
```

## §1 Preflight

### §1.0 Snapshot the board (read-only, baseline)

```bash
gh api graphql -f query='
query {
  node(id:"'"$PROJECT_ID"'") {
    ... on ProjectV2 {
      items(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue { number title state url
              labels(first: 30) { nodes { name } }
              milestone { title number } }
            ... on PullRequest { number title state url }
            ... on DraftIssue { title }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId name
                field { ... on ProjectV2SingleSelectField { id name } }
              }
              ... on ProjectV2ItemFieldTextValue {
                text field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number field { ... on ProjectV2Field { id name } }
              }
              ... on ProjectV2ItemFieldMilestoneValue {
                milestone { title } field { ... on ProjectV2Field { id name } }
              }
            }
          }
        }
      }
    }
  }
}' > /tmp/board-fieldvalues-pre.json

# Sanity check
jq '.data.node.items.nodes | length' /tmp/board-fieldvalues-pre.json
# Expected: 51
```

**Rollback:** none — read-only.

### §1.1 Build label-vs-field comparison

```bash
jq -r '
  .data.node.items.nodes[] |
  select(.content.__typename=="Issue") |
  {
    n: .content.number,
    title: .content.title,
    labels: [.content.labels.nodes[].name],
    fields: ([.fieldValues.nodes[] |
      select(.field.name) |
      {(.field.name): (.name // .text // .number // .date // .milestone.title)}
    ] | add)
  }
' /tmp/board-fieldvalues-pre.json > /tmp/board-summary.json

# Mismatch detection: priority label vs Priority field
jq -r '
  .[] |
  . as $row |
  ($row.labels | map(select(startswith("priority:")))[0] // "(none)") as $lbl |
  ($row.fields.Priority // "(none)") as $fld |
  if ($lbl | sub("priority:"; "")) != $fld and $lbl != "(none)" and $fld != "(none)"
  then "PRIORITY MISMATCH #\($row.n): label=\($lbl) vs field=\($fld) — \($row.title)"
  else empty end
' /tmp/board-summary.json
# Expected: empty (Phase 0 surveyed labels but didn't compare; if any
# print, the §1.2 corrections will run before §3 Step 1)

# Same for arc, type, impact (parallel jq blocks)
```

**Mismatch policy** (per Anthony's Phase 1 approval): project field wins.
If any line prints in §1.1, §1.2 runs to correct labels. If §1.1 is
empty for all four single-select fields (Priority, Arc, Type, Impact),
§1.2 is skipped.

**Rollback:** none — read-only.

### §1.2 Label corrections (CONDITIONAL — only if §1.1 found mismatches)

For each mismatch found in §1.1, run:

```bash
# Example shape — actual issue numbers + labels filled in from §1.1 output
gh issue edit <ISSUE_NUM> --repo "$REPO" \
  --remove-label "<stale-label>" \
  --add-label "<correct-label>"
```

**Rollback per row:**
```bash
gh issue edit <ISSUE_NUM> --repo "$REPO" \
  --remove-label "<correct-label>" \
  --add-label "<stale-label>"
```

If §1.1 is empty (the expected case based on Phase 0 — labels and fields
appeared aligned), this whole subsection is a no-op.

### §1.3 Pre-execution label existence check (fail-closed gate)

Read-only check that every label used in §3, §4, and §5 exists in the repo
**before** any mutation runs. New labels are **not** auto-created — if any
label is missing, STOP, surface the gap, and let Anthony decide whether to
create labels manually (`gh label create …` or via the GitHub UI) before
re-running. This converts a runtime "label not found" failure (which would
leave the board in a partially-mutated state) into a clean pre-execution
stop.

```bash
EXPECTED_LABELS='arc:ops|type:chore|priority:P1|priority:P2|impact:single-tenant|impact:trust|arc:PR-C|status:blocked'

PRESENT=$(gh label list --repo "$REPO" --limit 200 \
  | awk '{print $1}' \
  | grep -E "^(${EXPECTED_LABELS})$" \
  | sort -u)

REQUIRED=$(printf '%s\n' arc:ops type:chore priority:P1 priority:P2 \
            impact:single-tenant impact:trust arc:PR-C status:blocked | sort -u)

MISSING=$(comm -23 <(echo "$REQUIRED") <(echo "$PRESENT"))

if [ -n "$MISSING" ]; then
  echo "FAIL: missing labels in $REPO:"
  echo "$MISSING"
  echo "STOP — Phase 2 will not run. Either create these labels manually"
  echo "(via the GitHub UI or 'gh label create <name>'), or amend the plan"
  echo "to use existing labels, then re-run."
  exit 1
fi
echo "All 8 required labels present. Proceeding."
```

**Required labels and where they're used:**

| Label | Used by |
|---|---|
| `arc:ops` | §3 arcL card, §4 rebrand card |
| `type:chore` | §3 arcL card, §4 rebrand card |
| `priority:P1` | §4 rebrand card |
| `priority:P2` | §3 arcL card |
| `impact:single-tenant` | §3 arcL card |
| `impact:trust` | §4 rebrand card |
| `arc:PR-C` | §5 #29 — must remain present after `status:blocked` removal (verification only, not added/removed) |
| `status:blocked` | §5.4 (removal target on #29); §7 rollback (re-adds it) |

**Fail-closed semantics:** if any required label is absent, no `gh issue
create --label …` or `gh issue edit … --remove-label …` is attempted.
Phase 2 halts before the milestone is created.

**Rollback:** none — read-only.

### §1.4 Write-scope precondition check (fail-closed gate)

**Lesson from the 2026-05-04 run:** the original plan only verified the
`read:project` scope (which is sufficient for `gh project list / item-list /
field-list` queries). The mutating commands `gh project item-add` and
`gh project item-edit` require the **write** `project` scope, which is a
separate token grant. Without it, Phase 2 fails mid-execution at §3.3 with
`error: your authentication token is missing required scopes [project]`,
leaving the milestone created and the first issue created but not on the
board — a partial-mutation state that requires manual recovery.

This subsection converts that runtime failure into a clean pre-execution
stop.

```bash
SCOPES=$(gh auth status 2>&1 | grep "Token scopes" || true)

# Match a 'project' scope that is NOT preceded by 'read:' or other letters.
# Boundary: start-of-string OR a non-[a-z:] character before "project"
# AND a non-[a-z] character after "project".
if echo "$SCOPES" | grep -E "(^|[^a-z:])project([^a-z]|$)" >/dev/null; then
  echo "Write 'project' scope present. Proceeding with mutations."
else
  echo "FAIL: missing required write scope 'project' on token."
  echo "Current scopes: $SCOPES"
  echo "STOP — Phase 2 cannot create or modify project items without the"
  echo "write 'project' scope. The 'read:project' sub-scope alone allows"
  echo "queries but blocks mutations."
  echo
  echo "Fix: in your terminal, run"
  echo "  gh auth refresh -s project"
  echo "and complete the device-flow code paste in the browser. Re-run"
  echo "Phase 2 after 'gh auth status' shows 'project' (without the"
  echo "'read:' prefix) in the token scope list."
  exit 1
fi
```

**Note on `read:project` vs `project`:**

- `read:project` is a sub-scope: it grants only the read API surface
  (`ProjectV2` queries). The token literal as printed by `gh auth status`
  reads `read:project` (with the `read:` prefix).
- `project` is the full scope: read + write. Granting `project` makes
  the `read:project` sub-scope redundant; `gh auth status` will then list
  `project` (without the `read:` prefix), and `read:project` may or may
  not appear depending on past grants.

The grep pattern above matches `project` only when **not** preceded by
`read:` or other lowercase letters (and not followed by lowercase
letters). Examples that pass: `'gist', 'project', 'read:org'`. Examples
that fail: `'read:project'` alone, `'project-manager'` (hypothetical).

**Fail-closed semantics:** if write scope is absent, no milestone is
created, no issue is created, no `gh project item-*` is called.

**Rollback:** none — read-only.

**Why this gate is §1.4 (not §0):** the milestone-creation in §2 uses
the `repo` scope (which has been present since project setup), so it
would *succeed* even without `project` write scope. That makes the
failure asymmetric — milestone gets created, then the first
`gh project item-add` fails. Placing this gate after §1.3 (label gate)
and before §2 (milestone create) ensures the run halts before the first
side effect.

---

## §2 Step 1 — Create the `Pre-launch polish` milestone

```bash
MILESTONE_RESP=$(gh api -X POST repos/$REPO/milestones \
  -f title="Pre-launch polish" \
  -f state="open" \
  -f description="Pre-launch grooming and customer-facing polish: brand cleanup, URL/slug shape, OG/logo assets, copy fixes, and similar pre-GTM hygiene that isn't a launch blocker but should ship before tenant 2 or external traffic.")

MILESTONE_NUMBER=$(echo "$MILESTONE_RESP" | jq -r '.number')
echo "Created milestone #$MILESTONE_NUMBER"
# Expected: a small integer (probably 6, since 5 milestones already exist)
```

**Verify:**
```bash
gh api repos/$REPO/milestones/$MILESTONE_NUMBER | \
  jq '{number, title, state, open_issues, closed_issues, description}'
# Expected:
#  title: "Pre-launch polish"
#  state: "open"
#  open_issues: 0
#  closed_issues: 0
```

**Rollback:**
```bash
gh api -X DELETE repos/$REPO/milestones/$MILESTONE_NUMBER
# Safe ONLY if no issues attached. If §3 or §4 already attached issues,
# detach them first via `gh issue edit <N> --milestone ""` per attached
# issue, then DELETE.
```

---

## §3 Step 2 — Create the arcL card

### §3.1 Write the issue body to a tmpfile (avoid quoting/apostrophe traps)

`/tmp/arcL-card-body.md`:

````markdown
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
````

### §3.2 Create the issue with milestone, labels, body

```bash
ARC_L_RESP=$(gh issue create --repo "$REPO" \
  --title "arcL — shorten tenant slug (rent-this-dumpster-mnbxs4jm → rent-this-dumpster)" \
  --body-file /tmp/arcL-card-body.md \
  --milestone "Pre-launch polish" \
  --label "arc:ops,type:chore,priority:P2,impact:single-tenant")

ARC_L_URL=$(echo "$ARC_L_RESP" | tail -1)   # gh prints the URL on the last line
ARC_L_NUMBER=$(echo "$ARC_L_URL" | sed 's|.*/||')
echo "Created arcL issue #$ARC_L_NUMBER at $ARC_L_URL"
```

**Verify the issue:**
```bash
gh issue view "$ARC_L_NUMBER" --repo "$REPO" --json number,title,milestone,labels,state | \
  jq '{number, title, state, milestone: .milestone.title, labels: [.labels[].name]}'
# Expected:
#  state: "OPEN"
#  milestone: "Pre-launch polish"
#  labels: ["arc:ops","type:chore","priority:P2","impact:single-tenant"]
```

### §3.3 Add the issue to the project board

```bash
ARC_L_ITEM_RESP=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" \
  --url "$ARC_L_URL" --format json)
ARC_L_ITEM_ID=$(echo "$ARC_L_ITEM_RESP" | jq -r '.id')
echo "Added to board as item $ARC_L_ITEM_ID"
```

### §3.4 Set the 6 single-select project fields on the new card

```bash
# Status: Done
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_STATUS" --single-select-option-id "$OPT_STATUS_DONE"

# Type: chore
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_TYPE" --single-select-option-id "$OPT_TYPE_CHORE"

# Arc: ops
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ARC" --single-select-option-id "$OPT_ARC_OPS"

# Priority: P2
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_PRIORITY" --single-select-option-id "$OPT_PRIORITY_P2"

# Impact: single-tenant
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_IMPACT" --single-select-option-id "$OPT_IMPACT_SINGLE_TENANT"

# Audit Required: Done
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_AUDIT_REQUIRED" --single-select-option-id "$OPT_AUDIT_DONE"

# Bake-Window Safe: Yes
gh project item-edit --id "$ARC_L_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_BAKE_WINDOW_SAFE" --single-select-option-id "$OPT_BWS_YES"
```

(Effort field intentionally left unset — arcL is closed; an effort estimate
on a closed card is noise.)

### §3.5 Verify the card landed correctly

```bash
gh api graphql -f query='
query {
  node(id:"'"$ARC_L_ITEM_ID"'") {
    ... on ProjectV2Item {
      content { ... on Issue { number title milestone { title } labels(first:10) { nodes { name } } } }
      fieldValues(first: 30) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name field { ... on ProjectV2SingleSelectField { name } }
          }
        }
      }
    }
  }
}' | jq
# Expected: Status=Done, Type=chore, Arc=ops, Priority=P2,
# Impact=single-tenant, Audit Required=Done, Bake-Window Safe=Yes,
# milestone="Pre-launch polish"
```

### §3.6 Rollback for §3 (in reverse order)

```bash
# Undo field values: not required for the rollback path — closing the issue
# and deleting the project item makes them moot.

# Detach from project
gh project item-delete "$PROJECT_NUMBER" --owner "$OWNER" --id "$ARC_L_ITEM_ID"

# Close the issue (GitHub doesn't permit issue *deletion* via API; the
# number is permanent, but closing returns it to a benign state)
gh issue close "$ARC_L_NUMBER" --repo "$REPO" --comment "Rolled back: arcL card was created in error during Phase 2 execution and is being undone."

# Optional: edit title to mark as ROLLBACK so the issue list isn't cluttered
gh issue edit "$ARC_L_NUMBER" --repo "$REPO" \
  --title "[ROLLBACK] arcL card creation reverted"
```

> **Caveat:** GitHub will not reuse a closed issue's number. If you roll
> back arcL and re-execute later, the new card will get the next-higher
> issue number (#88 etc.), and the old #N will remain as a closed
> "[ROLLBACK]" placeholder. Acceptable but not pristine — flag for
> Anthony before rolling back.

---

## §4 Step 3 — Create the rebrand stack card

### §4.1 Write the issue body to a tmpfile

`/tmp/rebrand-card-body.md`:

````markdown
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
````

### §4.2 Create the issue

```bash
REBRAND_RESP=$(gh issue create --repo "$REPO" \
  --title "Rebrand customer-facing strings + API key prefix (ServiceOS → RentThisApp / rta_live_)" \
  --body-file /tmp/rebrand-card-body.md \
  --milestone "Pre-launch polish" \
  --label "arc:ops,type:chore,priority:P1,impact:trust")

REBRAND_URL=$(echo "$REBRAND_RESP" | tail -1)
REBRAND_NUMBER=$(echo "$REBRAND_URL" | sed 's|.*/||')
echo "Created rebrand-stack issue #$REBRAND_NUMBER"
```

### §4.3 Add to project + set fields

```bash
REBRAND_ITEM_RESP=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" \
  --url "$REBRAND_URL" --format json)
REBRAND_ITEM_ID=$(echo "$REBRAND_ITEM_RESP" | jq -r '.id')

# Status: Done
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_STATUS" --single-select-option-id "$OPT_STATUS_DONE"

# Type: chore
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_TYPE" --single-select-option-id "$OPT_TYPE_CHORE"

# Arc: ops
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ARC" --single-select-option-id "$OPT_ARC_OPS"

# Priority: P1
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_PRIORITY" --single-select-option-id "$OPT_PRIORITY_P1"

# Impact: trust
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_IMPACT" --single-select-option-id "$OPT_IMPACT_TRUST"

# Audit Required: No  (rebrand was not gated by an audit)
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_AUDIT_REQUIRED" --single-select-option-id "$OPT_AUDIT_NO"

# Bake-Window Safe: Yes
gh project item-edit --id "$REBRAND_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_BAKE_WINDOW_SAFE" --single-select-option-id "$OPT_BWS_YES"
```

### §4.4 Verify (mirror of §3.5 against `$REBRAND_ITEM_ID`)

Expected: Status=Done, Type=chore, Arc=ops, Priority=P1, Impact=trust,
Audit Required=No, Bake-Window Safe=Yes, milestone="Pre-launch polish".

### §4.5 Rollback (mirror of §3.6 against `$REBRAND_ITEM_ID` / `$REBRAND_NUMBER`)

Same shape: `gh project item-delete` → `gh issue close` → optional title
rename to `[ROLLBACK]`. Same caveat about issue-number permanence.

---

## §5 Step 4 — Apply #29 status flip + label removal + body footer

### §5.1 Find the project item id for #29

```bash
ISSUE_29_ITEM_ID=$(jq -r '
  .data.node.items.nodes[] |
  select(.content.__typename=="Issue" and .content.number==29) |
  .id
' /tmp/board-fieldvalues-pre.json)
echo "Item id for issue #29: $ISSUE_29_ITEM_ID"
# Sanity: must start with PVTI_
```

### §5.2 Capture current body for rollback safety

```bash
gh issue view 29 --repo "$REPO" --json body --jq '.body' \
  > /tmp/issue-29-body-pre.md
wc -c /tmp/issue-29-body-pre.md   # sanity: > 0 bytes
```

### §5.3 Flip status: Backlog → Ready

```bash
gh project item-edit --id "$ISSUE_29_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_STATUS" --single-select-option-id "$OPT_STATUS_READY"
```

**Rollback:**
```bash
gh project item-edit --id "$ISSUE_29_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_STATUS" --single-select-option-id "$OPT_STATUS_BACKLOG"
```

### §5.4 Remove the `status:blocked` label

```bash
gh issue edit 29 --repo "$REPO" --remove-label "status:blocked"
```

**Rollback:**
```bash
gh issue edit 29 --repo "$REPO" --add-label "status:blocked"
```

### §5.5 Append the body footer

```bash
{
  cat /tmp/issue-29-body-pre.md
  printf '\n\n---\n\n**Unblocked 2026-05-01** by PR #67 (PR-C2-pre, closed #28). Spec lives in PR #22 audit doc.\n'
} > /tmp/issue-29-body-new.md

gh issue edit 29 --repo "$REPO" --body-file /tmp/issue-29-body-new.md
```

**Rollback:**
```bash
gh issue edit 29 --repo "$REPO" --body-file /tmp/issue-29-body-pre.md
```

### §5.6 Verify #29 state

```bash
gh issue view 29 --repo "$REPO" --json number,title,labels,body | \
  jq '{number, title, labels: ([.labels[].name] | sort), body_tail: (.body[-200:])}'
# Expected (label set, sorted alphabetically — order is normalized for comparison):
#  labels: ["arc:PR-C","priority:P0","type:implementation"]   (no status:blocked)
#  body_tail ends with the new footer
# Verification passes on label set membership, not order.
```

```bash
gh api graphql -f query='
query {
  node(id:"'"$ISSUE_29_ITEM_ID"'") {
    ... on ProjectV2Item {
      fieldValues(first: 30) { nodes {
        ... on ProjectV2ItemFieldSingleSelectValue {
          name field { ... on ProjectV2SingleSelectField { name } } } } }
    }
  }
}' | jq '.data.node.fieldValues.nodes[] | select(.field.name=="Status")'
# Expected: { name: "Ready", field: { name: "Status" } }
```

---

## §6 Post-mutation verification

### §6.1 Re-snapshot the board

```bash
gh api graphql -f query='<same query as §1.0>' \
  > /tmp/board-fieldvalues-post.json

# Item count: 51 (pre) + 2 (arcL + rebrand) = 53
jq '.data.node.items.nodes | length' /tmp/board-fieldvalues-post.json
# Expected: 53
```

### §6.2 Compute the diff

Label arrays are sorted by name before comparison so non-deterministic
GraphQL ordering doesn't surface as false drift.

```bash
diff <(jq -S '
  .data.node.items.nodes
  | sort_by(.id)
  | map(.content.labels.nodes |= (sort_by(.name) // .))
' /tmp/board-fieldvalues-pre.json) \
     <(jq -S '
  .data.node.items.nodes
  | sort_by(.id)
  | map(.content.labels.nodes |= (sort_by(.name) // .))
' /tmp/board-fieldvalues-post.json) \
  > /tmp/board-diff.txt

wc -l /tmp/board-diff.txt
echo "---first 80 lines of diff---"
head -80 /tmp/board-diff.txt
```

### §6.3 Expected diff contents (anything else = unexpected drift)

| Change | Where |
|---|---|
| New item: arcL card (id `$ARC_L_ITEM_ID`, issue `#$ARC_L_NUMBER`) | net-new node in `items.nodes` |
| New item: rebrand card (id `$REBRAND_ITEM_ID`, issue `#$REBRAND_NUMBER`) | net-new node in `items.nodes` |
| #29 Status field: Backlog → Ready | mutated `fieldValues.nodes[?(field.name=="Status")].name` on the #29 item |
| #29 labels: removed `status:blocked` | mutated `content.labels.nodes` on the #29 item |
| #29 body: appended footer (visible only via `gh issue view`, not in this snapshot since the GraphQL doesn't pull body) | not visible in diff |
| **Linked issue state OPEN → CLOSED on any item where Status was set to Done in this run** (e.g. arcL #87, rebrand #88) | mutated `content.state` on the affected items — this is GitHub Projects' built-in auto-close-on-Done workflow firing; **expected, not drift** — see §6.5 |
| (Optional) any §1.2 label corrections | mutated `content.labels.nodes` on the affected items |

### §6.4 Drift gate

If the diff shows **anything outside §6.3**, STOP, write findings to
`/tmp/board-diff-unexpected.txt`, and surface to Anthony. Do **not**
auto-rollback — let Anthony decide.

**Carve-out (do NOT flag as drift):** linked issue `state` transitioning
from `OPEN` → `CLOSED` (with `state_reason: completed`) on any item where
Status was set to Done in this run. This is GitHub Projects' built-in
auto-close-on-Done workflow firing; it is documented in §6.3 and explained
in §6.5. The drift gate explicitly ignores this transition.

Filter the captured drift list before deciding to stop:

```bash
# Conceptual filter: from the raw diff between pre and post snapshots,
# strip out any lines that only express `state: "OPEN" → "CLOSED"` on
# items whose Status field was just set to Done. Whatever survives the
# filter is real drift.
```

If the diff matches §6.3 exactly, write a one-page summary:

```
=== Phase 2 mutation summary (2026-05-04) ===
- Milestone created: "Pre-launch polish" (#$MILESTONE_NUMBER)
- arcL card created: #$ARC_L_NUMBER (project item $ARC_L_ITEM_ID)
- rebrand card created: #$REBRAND_NUMBER (project item $REBRAND_ITEM_ID)
- #29 status: Backlog → Ready
- #29 labels: status:blocked removed
- #29 body: footer appended

Pre-snapshot:  /tmp/board-fieldvalues-pre.json (51 items)
Post-snapshot: /tmp/board-fieldvalues-post.json (53 items)
Diff:          /tmp/board-diff.txt
```

### §6.5 Note: GitHub Projects auto-close-on-Done is expected behavior

**Lesson from the 2026-05-04 run.** The §6.3 expected-diff list was
originally written without anticipating that setting `Status=Done` via
`gh project item-edit` would trigger GitHub Projects' built-in
"auto-close issue when status moved to a closed-mapped column" workflow.
That workflow is enabled **by default** on every new GitHub project (V2),
and it fires synchronously: the linked issue's `state` flips from
`OPEN` → `CLOSED` and its `state_reason` becomes `completed` within
seconds of the `Status` field write.

**For this run (2026-05-04):**

- arcL card (issue #87) — auto-closed at `2026-05-05T02:31:16Z` immediately
  after §3.4 set Status=Done.
- Rebrand-stack card (issue #88) — auto-closed at `2026-05-05T02:32:36Z`
  immediately after §4.3 set Status=Done.

Both `closed_by` values show `adepaolo456` because the workflow runs
under the token that triggered it; the close itself was the workflow's,
not a manual `gh issue close`.

**Why this is desirable, not undesirable:**

- arcL is genuinely shipped (slug rename complete on prod, Phase 1c
  verified).
- The rebrand stack is genuinely shipped (PRs #81–#84 merged).
- A Done card with `state=CLOSED` is the more semantically accurate
  end-state than a Done card with `state=OPEN`. The closed-at timestamp
  on the issue itself becomes a durable "completed-at" marker — useful
  later when reading the issue without going through the project board.
- For *retroactive* arc-level cards that are created as Done in the same
  Phase 2 run (the arcL/rebrand pattern in §3 / §4), this auto-closure
  is the desired end-state.

**Treat as expected, not drift.** §6.3 already lists this transition.
§6.4 explicitly carves it out of the drift gate. Do **not** include
"issue state changed OPEN → CLOSED on Status=Done items" as unexpected
drift in any future Phase 2 execution.

**Caveat for future plans where Done is set on an issue that should
remain OPEN:** this is unusual but possible (e.g. an issue that has
follow-up subtasks tracked elsewhere, where the original card is "done
enough" but the issue should remain a discussion thread). If that
becomes a use case, either:

1. Disable the project's auto-close-on-Done workflow at the project
   level (UI-only — no `gh` CLI surface for editing project workflows
   in current `gh` versions), or
2. Re-open the issue with `gh issue reopen <N>` after Phase 2 (but be
   aware: if Status remains Done, the workflow may re-fire on next
   project update — verify by re-running the snapshot).

For arcL and rebrand stack here, neither workaround is needed; closure
is the desired end-state.

### §6.6 Stop point

After §6.4, **STOP**:

- Do NOT commit any local file changes (the only file written by Phase 2
  is this plan; tmpfiles in `/tmp/` are not under git).
- Do NOT push.
- Do NOT modify CLAUDE.md, arc-state.md, feature-inventory.md, or any
  other docs to record this reconciliation pass — that is a separate
  doc-closure step Anthony will authorize after reviewing the post-snapshot.

---

## §7 Consolidated rollback playbook

> **Rollback order matters:** detach from project FIRST, then close the
> issue. Reversing this orphans a project item pointing at a closed issue,
> which is cosmetic but ugly to clean up later.

Single-shot rollback if Anthony wants to undo *everything* in this Phase 2
in reverse order:

```bash
# 1. #29 — restore body, restore label, restore status
gh issue edit 29 --repo "$REPO" --body-file /tmp/issue-29-body-pre.md
gh issue edit 29 --repo "$REPO" --add-label "status:blocked"
gh project item-edit --id "$ISSUE_29_ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_STATUS" --single-select-option-id "$OPT_STATUS_BACKLOG"

# 2. Rebrand card — detach from project, close issue, mark rollback
gh project item-delete "$PROJECT_NUMBER" --owner "$OWNER" --id "$REBRAND_ITEM_ID"
gh issue close "$REBRAND_NUMBER" --repo "$REPO" \
  --comment "Rolled back during Phase 2 reconciliation."
gh issue edit "$REBRAND_NUMBER" --repo "$REPO" --title "[ROLLBACK] rebrand card creation reverted"

# 3. arcL card — same shape
gh project item-delete "$PROJECT_NUMBER" --owner "$OWNER" --id "$ARC_L_ITEM_ID"
gh issue close "$ARC_L_NUMBER" --repo "$REPO" \
  --comment "Rolled back during Phase 2 reconciliation."
gh issue edit "$ARC_L_NUMBER" --repo "$REPO" --title "[ROLLBACK] arcL card creation reverted"

# 4. Milestone — only deletable once both new issues are detached and
#    closed (above)
gh api -X DELETE repos/$REPO/milestones/$MILESTONE_NUMBER

# 5. (Conditional) §1.2 label corrections — re-apply the inverse for each
#    edit recorded during the forward run
```

**Caveats:**
- Issue numbers `$ARC_L_NUMBER` and `$REBRAND_NUMBER` are **permanent**.
  Rollback closes them but does not delete them. A re-execution will
  produce different numbers.
- The "Pre-launch polish" milestone, once deleted, can be recreated, but
  it will get a new milestone `number` (the URL changes).
- Restoring #29's body via `--body-file /tmp/issue-29-body-pre.md` exactly
  reverts the body — this is byte-equivalent to the pre-state.

---

## §8 Execution gate (what counts as "go")

This plan executes ONLY if Anthony sends a follow-up prompt that
explicitly says "Phase 2 go" (or equivalent). Without that:

- ❌ no `gh api -X POST repos/.../milestones`
- ❌ no `gh issue create`
- ❌ no `gh issue edit`
- ❌ no `gh project item-add` / `item-edit` / `item-delete`
- ❌ no commit, no push
- ❌ no edit of any other repo file

The single exception in this document was creating
`docs/audits/2026-05-04-project-board-phase2-execution-plan.md` itself
(this file).

---

## §9 Compliance checklist

- [x] Full sequence of `gh project` / `gh issue` / `gh api` commands
- [x] Exact option IDs and field IDs from the Phase 0 field-list dump
- [x] Tmpfile body contents written verbatim (`/tmp/arcL-card-body.md`, `/tmp/rebrand-card-body.md`, `/tmp/issue-29-body-new.md`)
- [x] Per-step rollback note attached to each step
- [x] Preflight snapshot to `/tmp/board-fieldvalues-pre.json`
- [x] Mismatch policy (field wins) encoded as §1.2 conditional
- [x] Post-mutation verification (re-query + diff + drift gate)
- [x] Explicit execution ordering: 1 milestone → 2 arcL card → 3 rebrand card → 4 #29 mutations
- [x] No execution performed — plan only
- [x] No commit, no push
