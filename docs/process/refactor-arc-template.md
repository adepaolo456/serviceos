# Refactor Arc Template

How we run consolidation refactors at ServiceOS. This document is descriptive, not prescriptive — it captures what worked on the customer autocomplete unification (April 22, 2026) and prior arcs. Use it as a starting structure, not a rigid checklist.

**When this template applies:** scattered implementations of the same logical thing across multiple consumers, where the goal is to consolidate into a single source of truth without changing user-facing behavior.

**When it doesn't apply:** new feature work, single-file fixes, schema migrations without consumer logic, or anything where behavior is supposed to change.

## What this template produces

A refactor arc run with this template produces:

- A single source of truth for the consolidated logic
- Behavior-preserving migrations across all consumers
- A commit history that is bisectable and auditable
- A system with explicit invariants, not implicit behavior

If your arc didn't produce all four, the template wasn't followed.

---

## Core principles

These hold for every phase. Internalize them before you read the phase structure.

**Behavior preservation is the contract.** A refactor that changes user-facing behavior — even by accident, even if the new behavior is "better" — has failed its primary test. If you discover during the arc that the existing behavior was wrong, file the fix as a separate arc. Don't smuggle bug fixes into refactors.

**Single source of truth.** Whatever you're consolidating, there should be exactly one place it lives after the arc. If a consumer keeps a "shadow" copy "for safety," that's drift in the making. Reject it. **Consumers must not bypass the consolidated implementation** (e.g., direct fetches, local debounce logic, parallel state). If a consumer needs behavior the contract doesn't support, that's a contract discussion — not a local implementation.

**Audit before you touch.** Every site that consumes the thing being consolidated gets read end-to-end before any code changes. Surprises during migration are 10x more expensive than surprises during audit.

**No batching.** Migrate one consumer at a time. Stop between each. Verify before proceeding. Bugs caught at one site cost 1x to fix; bugs that propagate to four sites cost 5x to fix and are 4x harder to diagnose.

**Reviewer verifies own assumptions.** Before prescribing a fix, the reviewer must check the actual artifact (file, diff, test output) — not their memory of what they think it says. Misreads compound; the reviewer-executor safety loop only works if both sides verify.

**Executor verifies before acting.** When given an instruction that conflicts with the artifact, the executor stops and asks. "Stop and ask" beats "follow instructions" every time.

---

## Phase structure

Six phases. Each has a gate criterion that must be met before proceeding to the next. The gates are non-negotiable; phases are not.

### Phase 0 — Audit + Scope

**Goal:** understand what exists today so you can define what success looks like.

**Tasks:**
- Identify every consumer of the thing being consolidated. Use grep, not memory. Document the full list before you write any code.
- For each consumer, document the current implementation in 2-3 sentences: what it fetches, what state it holds, what UI it produces.
- Identify the pattern variations across consumers. The variations are the contract gaps that Phase 1 will need to resolve.
- Define behavioral invariants from the user's perspective: "when X happens, Y should be visible." These become the QA matrix in Phase 4.
- List explicitly what is in scope and what is out of scope. Out-of-scope items go to backlog with a one-line rationale.

**Gate to Phase 1:** every consumer is catalogued, every variation is named, and the scope is locked. If you discover a new consumer halfway through Phase 3, that's a Phase 0 failure — you didn't audit thoroughly enough.

**Failure mode this prevents:** discovering during Phase 3 that there's a fifth consumer you didn't know about, which forces re-doing Phase 1 contract work mid-migration.

### Phase 1 — Contract lock

**Goal:** decide the shape of the thing you're building before you build it.

This is the most under-appreciated phase. Decisions made here prevent rework everywhere downstream.

**Tasks:**
- Define the API surface. What does the consolidated thing expose? What does it deliberately NOT expose?
- Decide on the shape of internal state. If state has multiple sources of truth, that's a bug waiting to happen — collapse to one.
- Identify invariants. "The hook never auto-opens based on query length." "Cancellation must abort, bump requestId, and clear timers." These are constraints the implementation must satisfy.
- Classify primitives into buckets if applicable. The autocomplete arc had termination primitives (reset, clearResults) and non-termination primitives (setQuery, open, close), each with different requirements. Bucket classification prevents a future maintainer from accidentally putting a new primitive in the wrong category.
- Decide what's in the contract vs. what's call-site freedom. Composition lives at the call site; constraints live in the contract.

**Gate to Phase 2:** every contract decision is documented, written down somewhere (commit message, internal doc, or the implementation file's top-of-file comment). If you can't write down the decision, you haven't really made it.

**Failure mode this prevents:** mid-Phase-3 contract amendments that ripple back through already-migrated sites. Some contract amendments are unavoidable (audit surfaces a real gap), but most are preventable with thorough Phase 1 work.

### Phase 2 — Build core in isolation

**Goal:** ship the consolidated infrastructure with confidence before any consumer depends on it.

**Tasks:**
- Build the core thing. For React hooks, this often means a reducer + a hook + a presentational component, in three files (not one) so the reducer can be tested without React.
- Write tests at the lowest layer possible. Pure functions and reducers can be tested under node:test without React renderers; hook integration can be tested with React testing library if needed, but most invariants live in the pure layer.
- Document invariants in the source itself, not just in the commit message. Top-of-file comments age better than commits because they're co-located with the code that depends on them.
- Test cancellation, race conditions, and edge cases explicitly. These are where production bugs hide and where unit tests pay off most.

**Gate to Phase 3:** all tests pass, tsc clean, and the contract from Phase 1 is fully implemented. No consumer migrations begin until the infrastructure can stand alone.

**Failure mode this prevents:** discovering during the first migration that the infrastructure has a bug, then having to fix it across multiple sites once they all depend on it.

### Phase 3 — Per-site staged migration

**Goal:** migrate consumers one at a time with full review between each.

**The discipline rule:** after migrating each consumer, STOP. Review the diff. Verify behavior. Get explicit approval before touching the next site.

**Per-site workflow:**
1. **Audit the specific site.** Even though you audited it in Phase 0, re-read it with the contract in hand. Surface anything new.
2. **Implement the migration.** Replace local logic with calls to the consolidated infrastructure. Keep the diff small and focused.
3. **Run tsc and the test suite.** Both must be clean.
4. **Surface the diff for review.** Don't proceed until the reviewer signs off.
5. **Stop.** Move to the next site only after explicit approval.

**Mid-arc contract amendments:** sometimes a site's audit surfaces a real gap in the Phase 1 contract. Three options when this happens:

- **Site-local workaround.** The site does something unique that doesn't generalize. Document the workaround inline; don't change the contract.
- **Contract amendment.** The gap will affect future consumers too. Make the change strictly additive (don't break already-migrated sites), apply it surgically (smallest possible diff), and document why in the implementation comments.
- **Backlog.** The gap is real but not urgent. File it for a separate arc.

**Decision criterion:** if you can fix it at one site without changing the contract, do that. If you're tempted to add a flag or branch to the contract for one site, that's drift — push back to site-local instead. If multiple sites would benefit, contract amendment is correct.

**More than two amendments in a single arc is a signal that Phase 1 was under-specified.** At that point, pause and reconsider the contract rather than continuing migrations. The amendments themselves aren't the problem — the failure to surface them in Phase 1 is.

**Gate to Phase 4:** all consumers migrated, all tsc + tests clean, no untracked behavioral surprises.

**Failure modes this prevents:**
- Bugs propagating to all consumers because they migrated together
- Contract drift from accumulated site-local exceptions
- Lost reviewer attention from too-large diffs

### Phase 4 — Manual QA

**Goal:** verify in the browser what was verified in tests.

Unit tests verify mechanism. QA verifies experience. They're not redundant.

**The hierarchy: UI correctness > Network status.** A 200 response that the UI correctly ignores is working software (the requestId guard or equivalent doing its job). A canceled request the UI handles is also fine. The bug case is "UI reacts to stale data" or "UI fails to react to current data."

**Per-site QA matrix:**
- Baseline happy path (the thing the user does most)
- Edge cases that map to invariants from Phase 1
- Async scenarios: rapid-type, blur during in-flight fetch, abort, debounce
- State transition scenarios: select then clear, open then close, etc.

**Cross-cutting tests** (run on any one site, ideally the most async-sensitive):
- Stale-overwrite test: type slow, type fast, revert quickly. Verify UI shows only the latest query's results.
- Network tab debounce: rapid type, count actual fetch requests. Should match the debounce contract.
- Multi-tenant sanity if applicable.

**Trust feel.** If something feels laggy, flickery, stale, or inconsistent — even if you can't articulate why — that's a valid bug report. Don't over-filter.

**No smuggled improvements.** If post-migration behavior differs from pre-migration behavior and the difference wasn't explicitly approved in Phase 1, treat it as a regression — even if it appears to be an improvement. The contract was behavior preservation; "better" doesn't get a free pass. File the improvement as a separate arc.

**Gate to Phase 5:** every QA scenario passes. If anything fails, fix it before proceeding. Phase 5 is irreversible (or hard to reverse); QA is your last cheap stop.

### Phase 5 — Commit, merge, deploy

**Goal:** ship the arc with a commit history that tells the story.

**Commit structure:** prefer logical commits over squash. The autocomplete arc used four commits: infrastructure, simple migrations (NCF + BW), QSP + amendment 1, CPD + amendment 2. Each commit told a distinct part of the story; git log --oneline reads as a narrative.

When in doubt, ask: "if a bug surfaces six months from now and I need to bisect, will this commit shape help me?"

**Branch strategy:** feature branch over direct-to-main. Reasons:
- The push to a feature branch doesn't deploy production. Push to main does.
- Solo dev or not, the branch lets you visually review the 4 commits before they hit main.
- If anything's wrong mid-sequence (typo, wrong file in commit), you can fix locally before deployment.
- Single deploy on merge instead of four deploys on per-commit pushes.

**Deploy as irreversible step.** Treat the push to main with appropriate gravity. Confirm:
1. You have ~15 minutes to monitor + smoke-test
2. No active operator is mid-session doing something time-critical
3. Rollback path is ready (git revert --no-edit <commits> then push)

**Post-deploy:**
- Watch the Vercel build complete
- Hard refresh production in browser (Cmd+Shift+R)
- Run one smoke test per consumer (5 minutes total)
- Watch runtime logs for errors in the first ~10 minutes
- If anything breaks, revert first, diagnose after. Rollback is cheap; debugging live is expensive.

**Gate to "done":** zero errors in production runtime logs for 10+ minutes post-deploy, all smoke tests pass.

---

## The reviewer-executor safety loop

When the reviewer (often me) and the executor (often Claude Code, sometimes Anthony directly) are different agents, a safety loop emerges:

1. Reviewer prescribes an action based on their understanding of the artifact
2. Executor verifies the prescription against the actual artifact before acting
3. If mismatch, executor stops and reports
4. Reviewer corrects their understanding before re-prescribing

This loop caught a real bug during the autocomplete arc: the reviewer (me) misread a Phase 3A diff and rejected reset() as missing an abort() call when it wasn't. The executor (Claude Code) verified against the file on disk and pushed back. The reviewer corrected their reading and approved the original work.

**Both sides have responsibilities.** Reviewers verify their own claims against artifacts before prescribing. Executors verify instructions against artifacts before executing. Misreads happen; the loop catches them.

---

## Failure modes worth knowing about

**Bug propagating to N sites because all migrated together.** Prevented by Phase 3 staging discipline. The cost differential is real: bugs caught at one site are 1x; bugs that ship to four sites are 5x to fix and 4x harder to diagnose because you can't isolate which site introduced what.

**Contract drift from accumulated site-local exceptions.** Prevented by the Phase 3 amendment decision criterion. If multiple sites need the same exception, that's a contract gap, not a workaround.

**Stale results / focus races / cancellation gaps.** Prevented by explicit async modeling in Phase 1 (cancellation invariant, requestId guard, abort + clear) and Phase 4 stress testing. Most apps get this wrong because they don't model it explicitly.

**Bisect-impossible commit history.** Prevented by Phase 5 commit structure. Squashing all of a multi-week arc into one commit is convenient at merge time and infuriating at bisect time six months later.

**Mid-deploy panic because no rollback planned.** Prevented by Phase 5 explicit rollback strategy and pre-deploy readiness check. If you don't know the exact revert command before pushing, you're not ready to push.

**Reviewer misread cascading into wrong fix.** Prevented by reviewer-executor safety loop. The reviewer's job is not just to prescribe; it's to verify their own assumptions before prescribing.

---

## Quick reference: arc kickoff checklist

Before you start a refactor arc:

- [ ] All consumers identified (Phase 0)
- [ ] Behavioral invariants documented (Phase 0)
- [ ] In/out of scope locked (Phase 0)
- [ ] Contract decisions made and written down (Phase 1)
- [ ] Test infrastructure can run without consumers depending on it (Phase 2 prep)
- [ ] Per-site review process agreed upon (Phase 3 prep)
- [ ] Commit structure decided (Phase 5 prep)
- [ ] Rollback path identified (Phase 5 prep)

If any of these aren't true, you're not ready. Address before starting.

---

## When NOT to use this template

- Single-file fixes
- New feature development (no existing consumers to consolidate)
- Schema migrations that don't have consumer-side logic changes
- Hotfixes (skip phases 0-2, go straight to fix + commit + deploy with extra QA care)
- Anything where behavior is supposed to change

For those, use lighter-weight processes — this template's overhead isn't justified.

---

## Examples in the wild

**Customer autocomplete unification (April 22, 2026):** four consumers (NCF, BW, QSP, CPD), single hook + dropdown component, two contract amendments (ReactNode labels for QSP spinner, CLEAR_RESULTS for CPD below-min-length clear), zero rollbacks, zero production regressions. Total LOC: minus 107 from consumers, plus approximately 1300 in shared infra (mostly tests). Commits: aa0a767, 56111aa, db52400, f48761e.

(Add future arcs here as they ship.)

---

## Maintenance

Update this document after each arc that uses the template. Specifically:
- If the template held up, note it under "Examples in the wild"
- If the template needed adjustment, edit the relevant phase and note what changed at the bottom
- If a new failure mode surfaces, add it to "Failure modes worth knowing about"

The template is alive. Don't let it become stale.
