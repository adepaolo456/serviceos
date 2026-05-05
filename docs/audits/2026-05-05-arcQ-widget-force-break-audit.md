---
title: arcQ — PR-5 widget API force-break audit
phase: 0 (read-only audit; no mutations)
date: 2026-05-05
predecessors: arcL/M/N/O/P closed
verdict: NEEDS DECISION — PR-5 has two reasonable interpretations; recommend narrowing to one of them and splitting the surviving env-var fallbacks into a separate small arc.
mutations_in_this_doc: none
---

# arcQ — PR-5 widget API force-break audit

## What "PR-5 force-break" probably meant

Memory says *"widget API force-break (zero tenants embedded; tracked separately)."* That maps to two non-overlapping interpretations, only one of which is actually a force-break:

- **Interpretation A — Public API surface rename.** Rename `window.ServiceOS` → `window.RentThisApp`, `serviceos-booking-complete` → `rentthisapp-booking-complete`, `[ServiceOS]` console prefix, `serviceos-widget-*` DOM ids, `serviceos-fadein/scalein` keyframes, `window.serviceosOnBooking` callback. Per CLAUDE.md "Brand split", customer-facing identifiers should be `rentthisapp`. This IS a force-break (changes public API consumed by 3rd-party embed sites).
- **Interpretation B — Surviving env-var fallback cleanup.** Several files still default `process.env.X || 'serviceos-…vercel.app'`. Production has env vars set, so this is cosmetic in prod, but the fallback strings are stale. NOT a force-break — just hygiene.

## 1. `widget.js` current state

- 146 lines, hand-rolled vanilla JS at `web/public/widget.js`. **No versioning** (no `widget-v1.js`, `-v2.js`); single ABI.
- Last touched 2026-05-05 in PR #95 squash `f959e24` (arcO). Hosts already migrated:
  - Line 4: `var API = 'https://api.rentthisapp.com';` (arcN PR #90)
  - Line 5: `var APP = 'https://app.rentthisapp.com';` (arcO PR #95)
- Only one API endpoint hit: `GET /public/tenant/:slug/widget-config` (`api/src/modules/public/public.controller.ts:89`, service at `public.service.ts:369`). Endpoint has live `widget_enabled` + `allowed_widget_domains` gates. Not a deprecated alias.
- Public JS API surface still semantically `serviceos`-named (force-break candidates per Interpretation A): `window.ServiceOS.{open,close}`, `window.serviceosOnBooking`, postMessage event types `serviceos-booking-complete` and `serviceos-close`, DOM ids `serviceos-widget-{btn,overlay,modal,close,iframe,styles}`, console prefix `[ServiceOS]`, keyframes `serviceos-{fadein,scalein}`.

## 2. Tenant embed state (re-verified)

| Source | Count |
|---|---|
| `marketplace_integrations` rows | **0** |
| Active tenants | 1 |
| Tenants with `allowed_widget_domains` populated | **0** (NULL) |
| `tenant_settings` JSONB containing `serviceos`/`widget` strings | **0** |

PR-5's "zero tenants embedded" precondition still holds. Force-break is trivially safe at the embed-site level.

## 3. Surviving compat paths inventoried

### 3a. Env-var fallback defaults still pointing at OLD hosts (Interpretation B candidates) — **arcN miss**

Production runtime is fine because env vars are set in Vercel; these are cosmetic-only in prod but stale in code:

| File:Line | Var | Stale fallback |
|---|---|---|
| `api/src/modules/subscriptions/subscriptions.service.ts:93` | `FRONTEND_URL` | `https://serviceos-web-zeta.vercel.app` |
| `api/src/modules/subscriptions/subscriptions.service.ts:119` | `FRONTEND_URL` | same |
| `api/src/modules/automation/automation.service.ts:424` | `WEB_DOMAIN` | `serviceos-web-zeta.vercel.app` |
| `api/src/modules/portal/portal.service.ts:1170` | `FRONTEND_URL` | `https://serviceos-web-zeta.vercel.app` |
| `web/src/app/site/tenant-context.tsx:5` | `NEXT_PUBLIC_API_URL` | `https://serviceos-api.vercel.app` |
| `web/src/app/site/book/page.tsx:11` | `NEXT_PUBLIC_API_URL` | same |
| `web/src/app/register/page.tsx:91` | `NEXT_PUBLIC_API_URL` | same |
| `web/src/app/(dashboard)/invoices/page.tsx:504` | `NEXT_PUBLIC_API_URL` | same |

**3 API + 4 web = 7 fallback sites missed by arcN's "flip every fallback default" sweep.** Recommendation: **deprecation-warning-then-break** is overkill; just flip the literal in a small follow-up PR (call it arcR or merge into arcQ-narrowed).

### 3b. Intentional retention (per existing charter)

| File:Line | Retention reason |
|---|---|
| `api/src/main.ts:22` (`'https://serviceos-web-zeta.vercel.app'` in CORS allowlist) | Allows the legacy web host to call the API. `serviceos-web-zeta.vercel.app` still resolves and serves (curl confirmed `HTTP/2 200`). Removing breaks any client still on the old host. **Leave as-is** until old hosts are formally retired (deferred per arcN charter). |
| `api/api/index.js:3` (legacy serverless shim, hardcoded `ALLOWED_ORIGIN = 'https://serviceos-web-zeta.vercel.app'`) | Handles bare-`/` requests on the legacy `serviceos-api.vercel.app` alias. arcN smoke 9a/9b confirmed this still serves on both aliases. **Leave as-is** for the same reason. |
| `web/src/lib/tenant/extractSlugFromHost.ts:18` (`'serviceos-web-zeta.vercel.app'` in `ROOT_DOMAINS`) | Comment says *"legacy Vercel preview, retained during transition."* Intentional. **Leave as-is.** |
| `api/src/modules/mapbox/mapbox.service.ts:47,189` (hardcoded `Referer: 'https://serviceos-api.vercel.app'`) | Mapbox account uses Referer for free-tier domain whitelisting. Changing this requires updating the Mapbox account's allowed domains FIRST (out-of-band manual step at Mapbox.com). **Leave as-is** until Mapbox account update is coordinated. |
| `api/.claude/settings.local.json` (multiple curl examples with old host) | Local Claude permission allowlist; not deployed. Ignore. |

### 3c. Public widget API surface (Interpretation A candidates)

Already enumerated in §1. All semantically `serviceos`-named. CLAUDE.md "Brand split" rule (external surfaces = `rentthisapp`) implies these should be renamed. Zero tenants embed, so a force-break has no downstream impact today.

### 3d. `web/public/widget-test.html` — still references OLD host in embed snippet

| Line | Stale |
|---|---|
| 31 | `<script src="https://serviceos-web-zeta.vercel.app/widget.js" …>` (the docs example, NOT the live embed below at line 57 which was already updated by arcL PR #85) |

Internal dev test page; not customer-facing. Cosmetic miss from arcN. Bundle into the arcN-fallback-cleanup arc.

### 3e. Vercel rewrites/redirects/headers — none

`api/vercel.json` has CORS-related routes but no host bridging. `web/next.config.ts` is empty. No host-redirect or rewrite config exists. `serviceos-web-zeta.vercel.app` still resolves only because Vercel keeps the auto-generated subdomain alive on the web project.

## 4. API surface deprecation candidates

`GET /public/tenant/:slug/widget-config` is the **only** widget-specific endpoint. It's actively used and gated by `widget_enabled`. **No deprecation candidates.** No `@deprecated` markers on widget routes. The "legacy" comments grep'd in `api/src` are about historical data records (legacy customers, pre-correction reporting buckets), not widget endpoints. `LegacyBackfillModule` is a one-time data migration module, unrelated.

## 5. Per-path recommendation table

| Path | Recommendation |
|---|---|
| 7 env-var fallback sites (§3a) | flip literals in a small follow-up PR — **NOT a force-break** |
| `api/src/main.ts:22` CORS legacy entry | leave-as-is until formal old-host retirement |
| `api/api/index.js:3` legacy shim | leave-as-is (intentional legacy serverless handler) |
| `extractSlugFromHost.ts:18` legacy ROOT_DOMAINS entry | leave-as-is (commented intentional retention) |
| `mapbox.service.ts:47,189` Referer | leave-as-is (Mapbox account dependency) |
| `widget-test.html:31` docs embed snippet | flip literal in same follow-up as §3a |
| Public widget JS API rename (Interpretation A) | **decision pending** — see §6 |

## 6. Verdict: **NEEDS DECISION** (resolved 2026-05-05 — see § 7)

Two narrow paths forward, neither of which is the original "PR-5 force-break" as a single bundle:

- **Recommended:** **Close PR-5 as moot** for the widget API rename, keep the `serviceos`-named public JS surface as-is. Rationale: zero embeds today; the rename is brand-cosmetic, not safety-driven; and even when tenants do embed in the future, an alias-then-deprecate pattern is cleaner than a force-break against unknown future consumers. Open a small **arcQ′** to cover §3a + §3d (the 7 fallback sites + widget-test.html embed snippet) — that's the real cleanup arcN missed.
- **Alternative:** Proceed with the rename now while embeds are zero. Touch widget.js + widget-test.html + every doc reference. Smaller blast radius now than later. But still cosmetic; not enabling any new capability.

Either way, **the original "PR-5 force-break" framing should be retired**: there is no surviving widget API compat path to break (single-version `widget.js`, no aliases, no deprecated routes). The remaining work is fallback-default hygiene, which is not a force-break.

Decisions Anthony needs before any board card:

1. Close PR-5 / arcQ as moot for the widget API rename, OR proceed with the rename now?
2. Spawn arcQ′ for the 7 fallback sites + widget-test.html embed snippet (recommended regardless)?

No source code, branch, commit, push, board card, or external service was mutated by this audit.

---

## 7. Decision recorded (2026-05-05) — Anthony chose the Alternative

**Re-scope arcQ from "widget API force-break" to "widget public-API brand rename."** Reason: zero active embeds means this is the cheapest moment to rename the public widget API surface. Once a tenant embeds, a rename would require versioning, aliases, migration docs, and backwards-compat — all of which are avoidable today.

### Decisions

- **PR-5 force-break framing is retired.** No widget API compat path to break.
- **arcQ proceeds as a public-widget-API brand rename only.**
- **Namespace decision:** `window.RentThisApp` (NOT `window.RentThis` — that name would collide with the separate RentThis.com marketplace product per CLAUDE.md "Brand split" rule).
- **Casing conventions** (apply per-surface, do **not** normalize):

  | Surface | Convention | Example |
  |---|---|---|
  | window namespace | PascalCase | `window.RentThisApp` |
  | window callback global | camelCase | `window.rentThisAppOnBooking` |
  | Custom DOM event name | lowercase-hyphenated | `rentthisapp-booking-complete` |
  | DOM id / class | lowercase-hyphenated | `rentthisapp-widget-*` |
  | CSS @keyframes name | lowercase-hyphenated | `rentthisapp-fadein` |
  | Console log prefix | brand-cased in `[ ]` | `[RentThisApp]` |

### Phase 1a scope

- Files in scope: `web/public/widget.js` + `web/public/widget-test.html` only. **No `api/`, no `driver-app/`, no `web/src/`.**
- Rename per the casing table.
- Pair `@keyframes` definitions with `animation:` property references in lockstep.
- Keep current widget hosts unchanged (`api.rentthisapp.com` + `app.rentthisapp.com`).
- Do NOT alter `/public/tenant/:slug/widget-config` endpoint behavior.
- Do NOT introduce backwards-compat aliases (force-rename; zero embeds).
- Do NOT add versioned widget files.
- Do NOT touch the 8 stale fallback/default sites in §3a (deferred to arcQ′).
- Do NOT touch intentional retention paths in §3b.

### Deferred follow-up (arcQ′, intent recorded only — not created now)

**arcQ′ scope** (when authorized): the 7 stale env-var fallback sites in §3a + the legacy host URL on `widget-test.html:31`. Single audit-first PR. Treated as arcN/rebrand hygiene, not widget API rename. **Do not create the audit doc or the board card for arcQ′ now.**

### What this audit doc does NOT do

No source code, branch, commit, push, or external-service mutation. The arcQ board card is created as a separate explicit Phase 0 mutation alongside this amendment.

---

## Closure footnote (appended 2026-05-05 at Phase 1c)

arcQ closed end-to-end. Recording actual identifiers from the live execution.

| Phase | Identifier | Notes |
|---|---|---|
| 0 | board card #101 (project item `PVTI_lAHOAZbXz84BWRGTzgr3bac`) | created in Ready, all 7 fields set |
| 1a — PR-1 squash SHA | `8e8eb758629cfbbf7878ab07b229375fecbc7b6e` | PR [#102](https://github.com/adepaolo456/serviceos/pull/102), 2 files, +23/−23 |
| 1a — files touched | `web/public/widget.js` (19 line edits), `web/public/widget-test.html` (4 line edits) | lockstep keyframe-def + animation-ref pairing landed for both `fadein` and `scalein` |
| 1a — typecheck | `tsc --noEmit` clean | widget.js is plain JS in `web/public/` static-asset folder, not directly typechecked; full project tsc pass confirmed no TS regression |
| 1a — `Tracks #101` phrasing | dodged GitHub auto-close ✓ | issue #101 stayed OPEN with `closedAt: null` through Phase 1a + 1b |
| Web auto-deploy id | `dpl_2VRboVGeLjCG212k9U1ifgwH6hsH` | READY at `2026-05-05T15:51:19Z`, 4 seconds post-merge |
| 1b — bundle verification | 16/16 token criteria pass | scorecard below |
| 1c — closure docs PR | (this commit) | arc-state.md §11 entry + this footnote + flip #101 Done |

### Phase 1b verification scorecard

**File size sanity:** deployed `widget.js` = 5879 bytes, local `main` = 5879 bytes (exact byte match — pure literal substitution).

**widget.js token grep:**

| NEW token | Required | Hits |
|---|---|---|
| `window.RentThisApp` | ≥ 1 | **1** ✓ |
| `[RentThisApp]` | ≥ 1 | **3** ✓ (one per `console.error` site) |
| `rentthisapp-widget-` | ≥ 1 | **7** ✓ (6 distinct ids + getElementById lookup) |
| `rentthisapp-fadein` | ≥ 1 | **2** ✓ (def + ref paired) |
| `rentthisapp-scalein` | ≥ 1 | **2** ✓ (def + ref paired) |
| `rentthisapp-booking-complete` | ≥ 1 | **1** ✓ |
| `rentthisapp-close` | ≥ 1 | **1** ✓ |
| `rentThisAppOnBooking` | ≥ 1 | **2** ✓ (typeof + invocation) |

| OLD token | Required | Hits |
|---|---|---|
| `window.ServiceOS` | 0 | **0** ✓ |
| `[ServiceOS]` | 0 | **0** ✓ |
| `serviceos-widget-` | 0 | **0** ✓ |
| `serviceos-fadein` | 0 | **0** ✓ |
| `serviceos-scalein` | 0 | **0** ✓ |
| `serviceos-booking-complete` | 0 | **0** ✓ |
| `serviceos-close` | 0 | **0** ✓ |
| `serviceosOnBooking` | 0 | **0** ✓ |

**Host literals:** `https://api.rentthisapp.com` = 1, `https://app.rentthisapp.com` = 1 (preserved as planned).

**widget-test.html token grep:**

| Token | Required | Hits |
|---|---|---|
| `RentThisApp.open()` | ≥ 1 | **2** ✓ (onclick + button text on line 25) |
| `ServiceOS.open()` | 0 | **0** ✓ |
| `window.rentThisAppOnBooking` | ≥ 2 | **2** ✓ (doc snippet + live script) |
| `window.serviceosOnBooking` | 0 | **0** ✓ |
| `serviceos-web-zeta.vercel.app/widget.js` (line 31, deferred-arcQ′) | ≥ 1 | **1** acknowledged, NOT a failure (out of arcQ scope) |

**16/16 strict pass on widget.js. 4/4 strict pass on widget-test.html. 1 expected acknowledgment for the deferred-arcQ′ legacy host URL.**

### Workflow first: `Tracks #N` workaround validated

This is the first arc to use `Tracks #N` in a work-PR body to dodge GitHub's eager auto-close detector. Verified: issue #101 was `closed: false, closedAt: null` immediately before the Phase 1c project-Status flip, then closed precisely when the flip fired the auto-close-on-Done workflow. Future arcs where closure should originate from the closure-docs PR (not the work PR) should use `Tracks #N` or `Part of #N` in the work PR body and reserve `Closes #N` for the closure-docs PR body.

### Cheapest-moment heuristic captured

When blast radius is zero (no live consumers), force-rename without aliases. Once consumers exist, the same rename requires versioning + aliases + migration docs + backwards-compat — orders of magnitude more work. Heuristic: *if zero consumers today and a rename is directionally desirable, do it now*. Applies to future API key prefix renames, embed namespaces, public DOM event renames, etc.

### Per-item closure status

1. **`window.ServiceOS` → `window.RentThisApp`** — verified live in deployed bundle.
2. **`window.serviceosOnBooking` → `window.rentThisAppOnBooking`** — verified live (typeof + invocation).
3. **`serviceos-booking-complete` / `serviceos-close` → `rentthisapp-*`** — verified live.
4. **`[ServiceOS]` console prefix → `[RentThisApp]`** — verified live (3 sites).
5. **`serviceos-widget-*` DOM ids → `rentthisapp-widget-*`** — verified live (7 hits).
6. **`@keyframes serviceos-fadein/scalein` (+ `animation:` refs) → `rentthisapp-*` (paired)** — verified live (2 + 2 hits).
7. **`widget-test.html` examples** — `RentThisApp.open()` and `window.rentThisAppOnBooking` rendered correctly post-deploy.

### Permanent retention

No long-running aliases or env-var oddities introduced. arcQ was a pure literal-substitution rename over a public JS API surface that had zero consumers — the future first-embed will land directly on the new names.

### Manual TODO post-closure (Anthony, browser-only)

Load `https://app.rentthisapp.com/widget-test.html` in a browser. Confirm "Test Controls" button text shows `RentThisApp.open()`. Click it → widget overlay opens and a new floating "Book Now" button appears with id `rentthisapp-widget-btn` (DevTools → Elements → search). Optional: complete the embedded booking flow → confirm `[RentThisApp]` console prefix on any error logs.
