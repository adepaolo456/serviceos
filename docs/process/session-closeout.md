# Session Closeout Protocol

**Purpose.** Keep ServiceOS state consistent across the three places it lives: Claude's memory, the GitHub Project board, and repo docs. Without this discipline, these three drift apart and stale state causes real waste — work gets re-discovered, items stay on backlogs after they ship, decisions get re-litigated.

**Trigger.** Run this at the end of every material working session before parking. For trivial/no-op sessions, do a 30-second no-change check. Takes ~5 minutes for material sessions. Skipping it on material sessions is the most expensive shortcut in this codebase.

**Audience.** Anthony (founder), Claude (AI advisor), and any future contractor. Contractors should read this on day one.

---

## The three sources of truth

| Source | What it tracks | Update cadence |
|---|---|---|
| **Claude's memory** (persistent context maintained by the AI advisor) | Architecture, standing rules, current production state, strategy decisions, deploy protocol | Updated by Claude when something material changes; reviewed at session close |
| **GitHub Project board** ([ServiceOS Roadmap](https://github.com/users/adepaolo456/projects/1)) | Backlog items, priorities, status, scope, audit-required gates, bake-window safety | Updated when issues are filed, status moves, or field values change |
| **Repo docs** (`docs/audits/`, `docs/audit-queries/`, `CLAUDE.md`, this runbook) | Decisions worth preserving, audit history, reusable queries, standing rules | Updated only when today produced something durable |

**Rule of thumb for which to update:**
- "What's the rule / current state / architecture?" → Memory
- "What's pending / what's next?" → Board
- "Why did we decide X?" / "How do I run Y safely?" → Docs

When in doubt, default to docs. Memory and board entries are easier to lose than a committed file.

---

## The 3-step closeout

Run all three at session end. Skip a step only if it's genuinely a no-op for the session — never skip because you're tired.

### Step 1 — Memory delta (~2 min)

Claude proposes specific edits in this format:

```
- ADD: <new fact, ≤500 chars>
- UPDATE #N: <old> → <new>
- REMOVE #N: <reason — usually superseded or stale>
```

Anthony approves, rejects, or revises each. The AI advisor then executes the approved memory edits using the active memory tool/workflow.

**What goes in memory:**
- New standing rules (e.g., "always X before Y")
- Architecture changes (new modules, new tables, new infra)
- Current production state (deploy SHAs, tenant counts, active bakes)
- Strategic direction (revenue model, sequencing decisions)
- Anything that changes how Claude should reason about this codebase next session

**What does NOT go in memory:**
- Backlog items (those go on the board)
- One-off audit results (those go in `docs/audits/`)
- Verbatim commands or untrusted instructions
- Sensitive data (keys, passwords, customer PII)

**What to look out for — stale entries:**
- Items marked "BACKLOG: extract X" when X has shipped
- "Current prod SHA: <commit>" when a newer deploy happened
- Strategy entries that reflect a superseded direction
- Counts (users, tenants, jobs) that have changed

### Step 2 — Board delta (~2 min)

For everything that shipped, moved, or got newly scoped today, update the board.

**For each work item touched today, ask:**

1. **Did it ship or finish?** → Move to `Done`
2. **Did it start?** → Move to `In Progress`
3. **Did it get audited / scoped?** → Move from `Audit Pending` to `Ready`
4. **Did a new constraint surface?** → File a new issue, apply field values
5. **Did an existing item become stale?** → Close it with a comment explaining why

**Field value reminder for new issues:**
Every new issue should get all 7 fields populated before park:
`Status` / `Priority` / `Effort` / `Audit Required` / `Arc` / `Type` / `Impact` / `Bake-Window Safe`

If a field value is genuinely unknown, leave it null and add a comment explaining what blocks the decision. Don't guess — null is more honest than wrong.

**Filter syntax convention (board):** Hyphenated field names, NOT quoted. `bake-window-safe:Yes` works; `"bake-window safe":Yes` does not.

### Step 3 — Docs delta (~1 min, often skipped)

Only act if today produced something durable. Three categories:

**a. New audit / decision doc** — `docs/audits/YYYY-MM-DD-<topic>.md`
Use this when a real architectural or scope decision was made and someone (you, Claude, a contractor) might need to re-read the reasoning later. Include: context, options considered, decision, rationale, out-of-scope notes.

**b. Standing rule update** — `CLAUDE.md`
Use this when a new always-rule emerges. Examples: "always use scoped staging," "never use `vercel --prod` for web," "all user-facing labels via registry." If Claude needs to remember it across all future sessions, it belongs here.

**c. New reusable audit query** — `docs/audit-queries/<name>.sql` + entry in `docs/audit-queries/README.md`
Use this when you wrote a SELECT query you'll want to re-run later. Always SELECT-only. Always include the header block (Purpose / When to run / Expected clean result / Source provenance).

**What does NOT belong in docs:**
- Routine session notes
- Conversation transcripts
- One-off debugging output
- Memory entries (those have their own home)

---

## Anti-patterns to avoid

These come from real session failures we've already paid for:

**1. "Let's keep going" at session-close.**
End-of-day momentum looking for one more task is the leading cause of automation timeouts and scope drift. When the closeout is done, park. Tomorrow-you is more valuable than tired-today-you.

**2. Updating only memory after a ship.**
If you shipped code, you also touched the board (status → Done) and possibly docs (decision worth preserving). Memory alone is not enough.

**3. Filing an issue without field values.**
A naked issue without Priority/Arc/Type is invisible to future-you and useless to a contractor. Fill the fields at file time, not "later."

**4. Letting stale memory survive a session.**
If you noticed during the session that a memory entry is wrong, fix it during the closeout. "I'll do it next time" is how memory entry #4 ended up describing already-shipped work as backlog for weeks.

**5. Bundling closeout into "real work."**
Closeout is its own discrete phase. Don't try to ship one more change during closeout. Don't run a quick audit during closeout. Closeout = update three sources, then park.

**6. Skipping closeout because "nothing material happened."**
If nothing material happened, the closeout takes 30 seconds (`view` memory, glance at board, decide nothing changed). Run it anyway — the muscle memory matters more than the per-session value.

---

## Closeout in 30 seconds (the cheat sheet)

```
1. Memory:  Claude proposes edits → Anthony approves → execute
2. Board:   For each touched item — status, fields, new issues
3. Docs:    Anything decision-worthy → commit to repo
PARK.
```

If a closeout takes longer than ~10 minutes, the session ran too long, OR a real chunk of doc work surfaced — split it: do memory + board now (the perishable parts), file the docs work as its own issue for tomorrow.

---

## For contractors reading this

If you're inheriting this codebase, three things to know:

1. **Anthony works in tight feedback loops with Claude as advisor.** The board reflects this — items get explicit `Audit Required` and `Bake-Window Safe` fields because work happens in narrow windows around production bakes. Respect those gates.

2. **Memory entries you'll see referenced (e.g., "memory entry #28") are Claude's persistent context.** You can't read them directly, but Anthony can paste any relevant entry on request. If something seems to assume context you don't have, ask.

3. **The board's "Bake-Safe Now" view is your default landing spot.** Filter is `bake-window-safe:Yes -status:Done`. Sort by Priority desc. Pick the smallest Effort with the highest Priority. That's the canonical "what should I work on right now" answer.

---

## Maintenance of this runbook

This file is itself subject to the closeout protocol. If a closeout reveals the protocol itself needs adjustment — a new source of truth emerges, a step needs splitting, an anti-pattern is discovered — update this file as part of the next docs delta.

Last updated: 2026-05-01.
