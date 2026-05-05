---
title: arcO — small pre-launch cleanup batch
phase: 0 (read-only audit + plan; one authorized board card creation)
date: 2026-05-05
predecessors: arcN closed at PR #91 squash `e0c5bd6` (api.rentthisapp.com cutover)
verdict: SAFE — single-PR, single-deploy execution. 4 isolated changes, all low-risk.
mutations_in_this_doc: one project board card (#TBD, milestone "Pre-launch polish" #6, status Ready)
---

# arcO — Small pre-launch cleanup batch

## Scope

Four isolated changes shipping in **one PR / one squash commit / one API deploy**:

1. ADD `GET /health` (Path A — hand-rolled, no `@nestjs/terminus`).
2. CLEAN UP three stale URL follow-ups surfaced by arcN PR #90.
3. ADD `@Index` decorator to `customer.entity.ts` (documentation-as-code).
4. FIX stale `/* Logo — just green "OS" */` comment in `sidebar.tsx`.

## Per-item verification (post-PR #90, post-arcN-closure)

### Item 1 — `/health` endpoint

| Check | Result |
|---|---|
| Existing `/health` route or controller | **none** (only "healthy"-as-prose hits in reporting DTOs, unrelated) |
| `@nestjs/terminus` dependency | **not installed** |
| Health module | **none** |
| Wire-in target | `api/src/app.module.ts:122` — `controllers: [AppController]`; add `HealthController` |
| Auth posture | global `JwtAuthGuard` via `APP_GUARD`; `@Public()` decorator at `api/src/common/decorators/index.ts:9` is the existing pattern (used in `auth.controller.ts:414` and elsewhere) |

**Proposed file:** `api/src/health.controller.ts` (top-level, alongside `app.controller.ts`; no separate module — smallest diff). Body returns `{ status, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, timestamp: new Date().toISOString() }`.

### Item 2 — three stale URL follow-ups (lines confirmed live)

| File:Line | Current | Proposed |
|---|---|---|
| `web/public/widget.js:5` | `var APP = 'https://serviceos-web-zeta.vercel.app';` | `var APP = 'https://app.rentthisapp.com';` |
| `web/src/app/(dashboard)/settings/page.tsx:851` | `const websiteUrl = \`${slug}.serviceos.com\`;` | `const websiteUrl = \`${slug}.rentthisapp.com\`;` |
| `api/src/modules/auth/auth.controller.ts:420` | `'https://serviceos-web-zeta.vercel.app'` (fallback for `APP_URL` in `googleCallback`) | `'https://app.rentthisapp.com'` (matches the symmetric fallback at `auth.controller.ts:376`) |

All three line numbers verified post-arcN. Each is a hardcoded literal — no env-var pattern hidden behind them. Cross-references `arc-state.md §11` 2026-05-05 entry's "related observations" list. Behavior unchanged when the env vars are set in prod (which they are, per arcN Phase 1c); fix only matters when env vars are missing or in local dev.

### Item 3 — `customer.entity.ts` `@Index` decorator

| Check | Result |
|---|---|
| Path | `api/src/modules/customers/entities/customer.entity.ts` ✓ |
| Current decorators | `@Entity('customers')` only; no `@Index` |
| Current TypeORM imports | `Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn` — `Index` needs to be added |
| Live DB index | `idx_customers_tenant_email_unique`, partial unique on `(tenant_id, lower(email))` WHERE `email IS NOT NULL AND email <> ''` (verified via Supabase MCP) |
| TypeORM `synchronize` config | `app.module.ts:79` — `synchronize: isTest`. **Production is FALSE.** This contradicts the stale CLAUDE.md line 38 rule (already tracked as project board issue **#31**). |

**Implication of `synchronize: isTest` for arcO:** Prod TypeORM does NOT auto-sync schema from entity metadata. Adding `@Index` is purely declarative — zero runtime risk in prod, zero migration ceremony.

**Proposed decorator** (class level, applied just above `@Entity('customers')`):

```typescript
@Index(
  'idx_customers_tenant_email_unique',
  ['tenant_id', 'email'],
  { unique: true, where: '"email" IS NOT NULL AND "email" <> \'\'' },
)
@Entity('customers')
```

**Caveat:** the live DB index uses `lower(email)` expression. TypeORM `@Index` doesn't support expression columns; the decorator declares the simpler `(tenant_id, email)` tuple. A short JSDoc comment above the decorator notes this fidelity gap so future readers know the live index is the source of truth.

### Item 4 — `sidebar.tsx` stale comment

| Check | Result |
|---|---|
| Path:line | `web/src/components/sidebar.tsx:254` ✓ |
| Current comment | `{/* Logo — just green "OS" */}` |
| Rendered text on line 256 | `App` (already updated by PR #81 followup commit `88e4487e0`) |
| Other strays | grep confirms only this one occurrence |

**Proposed:** `{/* Logo — just green "App" */}` — comment-only edit, build-time noop.

## Single-PR strategy

Branch: `arc/O-small-cleanup-batch`. One squash commit. Files (5):

- `api/src/health.controller.ts` (new)
- `api/src/app.module.ts` (add `HealthController` to `controllers` array)
- `web/public/widget.js` (line 5)
- `web/src/app/(dashboard)/settings/page.tsx` (line 851)
- `api/src/modules/auth/auth.controller.ts` (line 420)
- `api/src/modules/customers/entities/customer.entity.ts` (add `Index` import + class-level decorator)
- `web/src/components/sidebar.tsx` (line 254)

(7 files total. Commit message will reference each item explicitly.)

## Phase-gated execution sequence

| Phase | Owner | Action | Stop boundary |
|---|---|---|---|
| **0** (this doc) | Claude Code | Audit + create board card | Stop after card created. Anthony reviews. |
| **1a** | Claude Code | Branch, edits, PR, squash-merge | Stop after merge. Report squash SHA. |
| **1b** | Claude Code | API deploy with Sentry pinning per CLAUDE.md | Stop when READY. Report deploy id + Sentry release. |
| **1c** | Claude Code | `/health` smoke (curl pre/post on alias + new host; verify JSON shape) | Stop. Report status + JSON body. |
| **1d** | Claude Code | Web auto-deploy verification (widget.js + settings page reflect new URLs) | Stop. Report deploy id + spot-check. |
| **1e** | Claude Code | Closure docs PR (arc-state.md §11 entry) + board card flip Ready → Done | Stop. Report PR # + squash SHA. |

## Smoke tests (Phase 1c/1d)

```bash
# Pre-deploy: /health does not exist on the existing prod build
curl -sI https://api.rentthisapp.com/health | head -1   # expect 404

# Post-deploy: /health returns 200 with correct JSON shape
curl -s https://api.rentthisapp.com/health | jq '{status, commit, timestamp}'
# expect: status="ok", commit=<6eca896-or-newer-SHA>, timestamp=<ISO8601>

# Old host alias serves the same endpoint
curl -s https://serviceos-api.vercel.app/health | jq '.status'
# expect: "ok"

# Web spot-checks (auto-deploy on merge)
curl -s https://app.rentthisapp.com/widget.js | head -6
# expect: var APP = 'https://app.rentthisapp.com';

# auth.controller.ts:420 path-coverage smoke (the fallback only fires when
# APP_URL env is unset; we don't exercise it directly — covered by the
# diff alone since prod APP_URL is set)
```

## Rollback

Single-commit revert: `git revert <squash-sha>` then redeploy API (Web auto-deploys). All four items are independent enough that a partial revert (e.g. dropping just the `@Index` decorator) is also possible via cherry-revert if needed.

## NOT in scope

- API Access card decision (separate audit-first arc).
- OAuth consent visual cleanup (separate observation/audit arc).
- Stripe Live webhook setup (issue **#93**, separate audit-first arc).
- `@nestjs/terminus` adoption / readiness/liveness probes (Path B, deferred).
- DB schema changes (Item 3 is documentation-only).
- Any other rebrand polish or pre-launch items.
- CLAUDE.md line 38 fix (issue **#31**, separate doc PR — flagged by this audit but not bundled).

## Anomalies / observations surfaced during audit

1. **`synchronize: isTest` discrepancy with CLAUDE.md line 38** — already tracked as #31. Surfaced again here because Item 3's safety analysis depends on it. Worth landing #31 separately.
2. **`@Index` decorator can't express `lower(email)`** — Item 3 will declare the simpler `(tenant_id, email)` tuple with a JSDoc note. Acceptable since `synchronize` is off in prod; the decorator is documentation, not enforcement.
3. **Auth.controller.ts:420 asymmetry with line 376** — line 376's fallback is already `https://app.rentthisapp.com` (correct); line 420 lagged. Item 2c restores symmetry.

## Workflow refinement (documented per Anthony's note)

**Card lifecycle:** arcL/arcM/arcN cards were created retroactively because their scope was clarified mid-execution. arcO's scope is fully predetermined at Phase 0. The card is therefore created in **Ready** status during Phase 0 (this audit), flipped to **In Progress** at Phase 1a start (optional, per arcM Q6), and to **Done** at Phase 1e closure. This Backlog→Ready→Done lifecycle is the right model when the audit settles scope before execution begins.

## Authorized board card (this is the one allowed mutation)

- **Project:** ServiceOS Roadmap (#1)
- **Milestone:** Pre-launch polish (#6)
- **Status:** **Ready** (audit confirms no blockers)
- **Type:** chore
- **Arc:** ops
- **Priority:** P2 (lower than arcN; this is hygiene)
- **Impact:** trust
- **Audit Required:** **Done** (this Phase 0 doc satisfies it)
- **Bake-Window Safe:** Yes
- **Body:** references this audit doc and lists the 4 items.

---

## Closure footnote (appended 2026-05-05 at Phase 1e)

arcO closed end-to-end. Recording actual identifiers from the live execution.

| Phase | Identifier | Notes |
|---|---|---|
| 1a — PR-1 squash SHA | `f959e2472b35f5d260d4297f921646fa3fc9e39e` | PR [#95](https://github.com/adepaolo456/serviceos/pull/95), 7 files, +40/−5 |
| 1b — API deploy id | `dpl_DVTUHKoYV7uAYcPu6Z245bv5FPn2` | Sentry release pinned to `f959e24`, build 16s, total 37s |
| 1c — `/health` smoke | `status: "ok"` ✓, HTTP 200 ✓, on both aliases | **Anomaly surfaced:** `commit: ""` (empty string) instead of SHA-or-`null` |
| **1c.1** — null-shape fix | PR [#96](https://github.com/adepaolo456/serviceos/pull/96) squash `59955003a6179dce6015563cd48dd49e83dc6456` | Single-char operator `??` → `\|\|` in `api/src/health.controller.ts`; 1 file, +1/−1; `nest build` clean |
| 1c.1 — API redeploy id | `dpl_ERzqp3isdBRuTMcqyAchksiEmSC5` | Sentry release pinned to `5995500`, build 16s, total 37s |
| 1c.1 — re-smoke | `{ status: "ok", commit: null, timestamp: "2026-05-05T14:20:01.989Z" }` | JSON shape contract restored |
| 1d — Web auto-deploy | `dpl_9bzruM9sAsHujFD6Q4WZg3W65bP1` | github auto-deploy on PR #96 merge, target production, created `2026-05-05T14:19:03Z` |
| 1d — `widget.js` verification | `var API = 'https://api.rentthisapp.com'; var APP = 'https://app.rentthisapp.com';` | both live, cache-busted fetch |
| 1d — `/login` bundle grep (12 chunks) | `rentthisapp.com=6, serviceos.com=0, serviceos-web-zeta.vercel.app=0` | clean bundle |
| 1e — closure docs PR | (this commit) | arc-state.md §11 entry + this footnote + flip #94 Done |

### Phase 1c.1 amendment

Phase 1c smoke surfaced `commit: ""` (empty string), which violated the audit's
expected `{ commit: SHA \| null }` contract. Diagnosis accepted:

- `--build-env VERCEL_GIT_COMMIT_SHA=…` injects at **build time** (Sentry
  release pinning works because the SHA is baked into the build artifact).
- The Vercel **runtime lambda env** exposes `VERCEL_GIT_COMMIT_SHA` as an empty
  string by default — different env table from the build env.
- `?? null` (nullish coalescing) only catches `null`/`undefined`, so the empty
  string passed through and reached the JSON response.

Fix: switch to `|| null` so the empty string is treated as falsy and falls
through to `null`. One-character change. `nest build` clean. Re-smoke at
Phase 1c.1 confirmed JSON shape restored.

Out of scope (deferred): making the actual SHA appear at runtime requires
either adding `VERCEL_GIT_COMMIT_SHA` as a runtime env var on the API project
(Vercel auto-overwrites it with the deployment's SHA) or reading a different
reliably-set runtime var. Not pursued in arcO.

### Per-item closure status

1. **`GET /health`** — live on both aliases (`api.rentthisapp.com` and `serviceos-api.vercel.app`). Returns `{ status: "ok", commit: null, timestamp: <fresh ISO> }`. Sentry release pinning verified at deploy time.
2. **Three arcN URL follow-ups** — widget.js APP swap verified live (cache-busted fetch); auth.controller frontendUrl fallback live (verified by source diff in PR #95); settings websiteUrl live (verified in PR #95 diff; not exercised by `/login` bundle graph but landed in the deployed code).
3. **`@Index` decorator on customer.entity.ts** — declarative-only (production `synchronize: isTest`); zero runtime risk.
4. **sidebar.tsx comment** — build-time noop; verified in PR #95 diff.

### Workflow refinement (recorded for future arcs)

arcO is the **first arc with its project-board card created at scoping (Phase 0)
in Ready status**, rather than retroactively at closure. arcL/arcM/arcN cards
were created in Done at closure because their scope clarified mid-execution.
For fully pre-scoped arcs (audit settles scope first), the Backlog→Ready→Done
lifecycle is the right model: card creation is itself a small mutation
during Phase 0, status flips to In Progress (optional) at Phase 1a start, and
to Done at Phase 1e closure. Documented in audit § "Workflow refinement"
and again here.

### Permanent retention

No long-running aliases or env-var oddities to track. arcO didn't introduce
any infrastructure that needs ongoing maintenance — the four items are
either inert documentation (Item 3 + 4) or tiny additive code (Items 1 + 2).
